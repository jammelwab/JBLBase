//! Training progress ("Trainingsfortschritt") of repertoire decks.
//!
//! Until now the FSRS cards lived in the browser's `localStorage`, keyed by
//! the absolute file path. They were bound to one device and lost when a
//! repertoire was renamed. They now live in `training.sqlite3` in the app
//! data folder, keyed by a stable deck id (the repertoire id from the
//! `.info` file, plus the game number for files with several games) and the
//! position (FEN without move counters).
//!
//! Reviews are an append-only log, so later syncing between devices never
//! has to resolve conflicts for them.
//!
//! Card and review contents are stored as JSON exactly as the frontend sends
//! them (ts-fsrs objects); this module does not interpret them.

use std::{
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use log::{info, warn};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use specta::Type;

use crate::{error::Error, AppState};

pub const TRAINING_FILE_NAME: &str = "training.sqlite3";

#[derive(Default)]
pub struct TrainingStore {
    inner: Mutex<Option<Connection>>,
}

/// One training card as the frontend uses it.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Type)]
pub struct TrainingCard {
    pub fen: String,
    pub answer: String,
    /// FSRS card state as JSON.
    pub card: String,
}

/// One entry of the review log.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Type)]
pub struct TrainingReview {
    pub fen: String,
    /// FSRS review log as JSON.
    pub log: String,
}

#[derive(Serialize, Debug, Clone, PartialEq, Type)]
pub struct TrainingDeck {
    pub cards: Vec<TrainingCard>,
    pub reviews: Vec<TrainingReview>,
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Position key: the first four FEN fields (placement, side to move,
/// castling, en passant). Move counters are dropped, so transpositions share
/// one card.
pub fn position_key(fen: &str) -> String {
    fen.split_whitespace().take(4).collect::<Vec<_>>().join(" ")
}

fn open_connection(path: &Path) -> Result<Connection, rusqlite::Error> {
    let conn = Connection::open(path)?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA busy_timeout = 2000;
         PRAGMA journal_size_limit = 1048576;
         CREATE TABLE IF NOT EXISTS cards (
             deck       TEXT    NOT NULL,
             position   TEXT    NOT NULL,
             fen        TEXT    NOT NULL,
             answer     TEXT    NOT NULL,
             card       TEXT    NOT NULL,
             ord        INTEGER NOT NULL,
             updated_at INTEGER NOT NULL,
             PRIMARY KEY (deck, position)
         ) WITHOUT ROWID;
         CREATE TABLE IF NOT EXISTS reviews (
             id          INTEGER PRIMARY KEY AUTOINCREMENT,
             deck        TEXT    NOT NULL,
             position    TEXT    NOT NULL,
             fen         TEXT    NOT NULL,
             log         TEXT    NOT NULL,
             reviewed_at INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS reviews_deck ON reviews (deck, id);
         CREATE TABLE IF NOT EXISTS meta (
             key   TEXT PRIMARY KEY,
             value TEXT NOT NULL
         );
         INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', '1');",
    )?;
    Ok(conn)
}

impl TrainingStore {
    /// Opens (or creates) the store. Failures are logged; training then
    /// works for the session but is not saved.
    pub fn open(&self, path: PathBuf) {
        match open_connection(&path) {
            Ok(conn) => {
                info!("Training store opened at {}", path.display());
                *self.inner.lock().unwrap() = Some(conn);
            }
            Err(e) => warn!("Could not open training store {}: {e}", path.display()),
        }
    }

    #[cfg(test)]
    pub fn open_in_memory() -> Self {
        let store = Self::default();
        *store.inner.lock().unwrap() = Some(open_connection(Path::new(":memory:")).unwrap());
        store
    }

    fn with_conn<T>(
        &self,
        f: impl FnOnce(&mut Connection) -> Result<T, rusqlite::Error>,
    ) -> Result<T, Error> {
        let mut guard = self
            .inner
            .lock()
            .map_err(|_| Error::TrainingStoreUnavailable)?;
        let conn = guard.as_mut().ok_or(Error::TrainingStoreUnavailable)?;
        Ok(f(conn)?)
    }

    /// The deck's cards in their saved order and its whole review log.
    /// `None` when nothing was ever saved for the deck.
    pub fn load(&self, deck: &str) -> Result<Option<TrainingDeck>, Error> {
        self.with_conn(|conn| {
            let cards = conn
                .prepare("SELECT fen, answer, card FROM cards WHERE deck = ?1 ORDER BY ord")?
                .query_map([deck], |r| {
                    Ok(TrainingCard {
                        fen: r.get(0)?,
                        answer: r.get(1)?,
                        card: r.get(2)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            let reviews = conn
                .prepare("SELECT fen, log FROM reviews WHERE deck = ?1 ORDER BY id")?
                .query_map([deck], |r| {
                    Ok(TrainingReview {
                        fen: r.get(0)?,
                        log: r.get(1)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            let known: bool = conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM meta WHERE key = ?1)",
                [format!("deck:{deck}")],
                |r| r.get(0),
            )?;
            Ok(if known || !cards.is_empty() || !reviews.is_empty() {
                Some(TrainingDeck { cards, reviews })
            } else {
                None
            })
        })
    }

    /// Replaces the deck's cards with `cards` (in this order). Cards whose
    /// position is no longer in the list are removed; their reviews stay.
    pub fn save_cards(&self, deck: &str, cards: &[TrainingCard]) -> Result<(), Error> {
        let now = now_secs();
        self.with_conn(|conn| {
            let tx = conn.transaction()?;
            tx.execute(
                "INSERT OR IGNORE INTO meta (key, value) VALUES (?1, ?2)",
                params![format!("deck:{deck}"), now.to_string()],
            )?;
            tx.execute("DELETE FROM cards WHERE deck = ?1", [deck])?;
            {
                let mut insert = tx.prepare(
                    "INSERT INTO cards (deck, position, fen, answer, card, ord, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                     ON CONFLICT (deck, position) DO NOTHING",
                )?;
                for (i, c) in cards.iter().enumerate() {
                    insert.execute(params![
                        deck,
                        position_key(&c.fen),
                        c.fen,
                        c.answer,
                        c.card,
                        i as i64,
                        now
                    ])?;
                }
            }
            tx.commit()
        })
    }

    /// Appends reviews to the deck's log.
    pub fn append_reviews(&self, deck: &str, reviews: &[TrainingReview]) -> Result<(), Error> {
        let now = now_secs();
        self.with_conn(|conn| {
            let tx = conn.transaction()?;
            {
                let mut insert = tx.prepare(
                    "INSERT INTO reviews (deck, position, fen, log, reviewed_at)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                )?;
                for r in reviews {
                    insert.execute(params![deck, position_key(&r.fen), r.fen, r.log, now])?;
                }
            }
            tx.commit()
        })
    }
}

#[tauri::command]
#[specta::specta]
pub async fn training_load_deck(
    deck: String,
    state: tauri::State<'_, AppState>,
) -> Result<Option<TrainingDeck>, Error> {
    state.training.load(&deck)
}

#[tauri::command]
#[specta::specta]
pub async fn training_save_cards(
    deck: String,
    cards: Vec<TrainingCard>,
    state: tauri::State<'_, AppState>,
) -> Result<(), Error> {
    state.training.save_cards(&deck, &cards)
}

#[tauri::command]
#[specta::specta]
pub async fn training_append_reviews(
    deck: String,
    reviews: Vec<TrainingReview>,
    state: tauri::State<'_, AppState>,
) -> Result<(), Error> {
    state.training.append_reviews(&deck, &reviews)
}

#[cfg(test)]
mod tests {
    use super::*;

    const START: &str = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";

    fn card(fen: &str, answer: &str, reps: u32) -> TrainingCard {
        TrainingCard {
            fen: fen.into(),
            answer: answer.into(),
            card: format!("{{\"reps\":{reps}}}"),
        }
    }

    #[test]
    fn unknown_deck_is_none() {
        let store = TrainingStore::open_in_memory();
        assert_eq!(store.load("nope").unwrap(), None);
    }

    #[test]
    fn saves_and_loads_in_order() {
        let store = TrainingStore::open_in_memory();
        let b = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";
        store
            .save_cards("rep1", &[card(START, "e5", 1), card(b, "Nf3", 0)])
            .unwrap();
        let deck = store.load("rep1").unwrap().unwrap();
        assert_eq!(deck.cards.len(), 2);
        assert_eq!(deck.cards[0].answer, "e5");
        assert_eq!(deck.cards[1].answer, "Nf3");
        assert!(store.load("rep2").unwrap().is_none());
    }

    #[test]
    fn empty_deck_stays_known() {
        let store = TrainingStore::open_in_memory();
        store.save_cards("rep1", &[]).unwrap();
        assert_eq!(
            store.load("rep1").unwrap(),
            Some(TrainingDeck {
                cards: vec![],
                reviews: vec![]
            })
        );
    }

    #[test]
    fn saving_replaces_cards_but_keeps_reviews() {
        let store = TrainingStore::open_in_memory();
        store.save_cards("rep1", &[card(START, "e5", 0)]).unwrap();
        store
            .append_reviews(
                "rep1",
                &[TrainingReview {
                    fen: START.into(),
                    log: "{\"rating\":3}".into(),
                }],
            )
            .unwrap();
        store.save_cards("rep1", &[card(START, "c5", 1)]).unwrap();
        let deck = store.load("rep1").unwrap().unwrap();
        assert_eq!(deck.cards, vec![card(START, "c5", 1)]);
        assert_eq!(deck.reviews.len(), 1);

        store.save_cards("rep1", &[]).unwrap();
        let deck = store.load("rep1").unwrap().unwrap();
        assert!(deck.cards.is_empty());
        assert_eq!(deck.reviews.len(), 1);
    }

    #[test]
    fn move_counters_do_not_split_positions() {
        let store = TrainingStore::open_in_memory();
        let same = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 4 9";
        store
            .save_cards("rep1", &[card(START, "e5", 2), card(same, "c5", 0)])
            .unwrap();
        let deck = store.load("rep1").unwrap().unwrap();
        assert_eq!(deck.cards, vec![card(START, "e5", 2)]);
    }

    #[test]
    fn reviews_are_appended_in_order() {
        let store = TrainingStore::open_in_memory();
        for rating in 1..=3 {
            store
                .append_reviews(
                    "rep1",
                    &[TrainingReview {
                        fen: START.into(),
                        log: format!("{{\"rating\":{rating}}}"),
                    }],
                )
                .unwrap();
        }
        let deck = store.load("rep1").unwrap().unwrap();
        let logs: Vec<_> = deck.reviews.iter().map(|r| r.log.as_str()).collect();
        assert_eq!(logs, ["{\"rating\":1}", "{\"rating\":2}", "{\"rating\":3}"]);
    }
}
