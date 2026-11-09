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
//!
//! Cloud sync (schema 2): cards carry `updated_at` (ms), a `deleted` mark
//! instead of being removed, and a `dirty` flag for changes not yet
//! uploaded. Reviews get a random `uid`, which is also their id in the
//! cloud, so a review is never stored twice.

use std::{
    collections::{BTreeSet, HashMap, HashSet},
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

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// A card as it is synced: with its deck, position key, change time and
/// deletion mark.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Type)]
#[serde(rename_all = "camelCase")]
pub struct SyncCard {
    pub deck: String,
    pub position: String,
    pub fen: String,
    pub answer: String,
    pub card: String,
    pub ord: u32,
    /// Milliseconds since 1970.
    pub updated_at: f64,
    pub deleted: bool,
}

/// Identifies one uploaded card version, so only that version is marked
/// as synced (a newer local change stays dirty).
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Type)]
#[serde(rename_all = "camelCase")]
pub struct SyncCardKey {
    pub deck: String,
    pub position: String,
    pub updated_at: f64,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Type)]
#[serde(rename_all = "camelCase")]
pub struct SyncReview {
    pub uid: String,
    pub deck: String,
    pub fen: String,
    pub log: String,
    /// Milliseconds since 1970.
    pub reviewed_at: f64,
}

#[derive(Serialize, Debug, Clone, PartialEq, Type)]
pub struct TrainingPending {
    pub cards: Vec<SyncCard>,
    pub reviews: Vec<SyncReview>,
}

/// Position key: the first four FEN fields (placement, side to move,
/// castling, en passant). Move counters are dropped, so transpositions share
/// one card.
pub fn position_key(fen: &str) -> String {
    fen.split_whitespace().take(4).collect::<Vec<_>>().join(" ")
}

fn open_connection(path: &Path) -> Result<Connection, rusqlite::Error> {
    let mut conn = Connection::open(path)?;
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
    migrate(&mut conn)?;
    Ok(conn)
}

fn schema_version(conn: &Connection) -> Result<i64, rusqlite::Error> {
    let value: String = conn.query_row(
        "SELECT value FROM meta WHERE key = 'schema_version'",
        [],
        |r| r.get(0),
    )?;
    Ok(value.parse().unwrap_or(1))
}

/// Schema 2: sync columns. Times move from seconds to milliseconds.
fn migrate(conn: &mut Connection) -> Result<(), rusqlite::Error> {
    if schema_version(conn)? >= 2 {
        return Ok(());
    }
    let tx = conn.transaction()?;
    tx.execute_batch(
        "ALTER TABLE cards ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;
         ALTER TABLE cards ADD COLUMN dirty INTEGER NOT NULL DEFAULT 1;
         UPDATE cards SET updated_at = updated_at * 1000;
         CREATE INDEX IF NOT EXISTS cards_dirty ON cards (dirty) WHERE dirty = 1;
         ALTER TABLE reviews ADD COLUMN uid TEXT;
         ALTER TABLE reviews ADD COLUMN dirty INTEGER NOT NULL DEFAULT 1;
         UPDATE reviews SET uid = lower(hex(randomblob(16))) WHERE uid IS NULL;
         UPDATE reviews SET reviewed_at = reviewed_at * 1000;
         CREATE UNIQUE INDEX IF NOT EXISTS reviews_uid ON reviews (uid);
         CREATE INDEX IF NOT EXISTS reviews_dirty ON reviews (dirty) WHERE dirty = 1;
         UPDATE meta SET value = '2' WHERE key = 'schema_version';",
    )?;
    tx.commit()?;
    info!("Training store migrated to schema 2");
    Ok(())
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
                .prepare(
                    "SELECT fen, answer, card FROM cards
                     WHERE deck = ?1 AND deleted = 0 ORDER BY ord",
                )?
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
    /// position is no longer in the list are marked deleted; their reviews
    /// stay. Only cards that really changed are marked for upload.
    pub fn save_cards(&self, deck: &str, cards: &[TrainingCard]) -> Result<(), Error> {
        let now = now_ms();
        self.with_conn(|conn| {
            let tx = conn.transaction()?;
            tx.execute(
                "INSERT OR IGNORE INTO meta (key, value) VALUES (?1, ?2)",
                params![format!("deck:{deck}"), now.to_string()],
            )?;
            let existing: HashMap<String, (String, String, String, i64, bool)> = tx
                .prepare(
                    "SELECT position, fen, answer, card, ord, deleted FROM cards WHERE deck = ?1",
                )?
                .query_map([deck], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        (r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?),
                    ))
                })?
                .collect::<Result<_, _>>()?;
            let mut seen = HashSet::new();
            {
                let mut upsert = tx.prepare(
                    "INSERT INTO cards (deck, position, fen, answer, card, ord, updated_at, deleted, dirty)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, 1)
                     ON CONFLICT (deck, position) DO UPDATE SET
                         fen = excluded.fen, answer = excluded.answer, card = excluded.card,
                         ord = excluded.ord, updated_at = excluded.updated_at,
                         deleted = 0, dirty = 1",
                )?;
                let mut reorder =
                    tx.prepare("UPDATE cards SET ord = ?3 WHERE deck = ?1 AND position = ?2")?;
                for (i, c) in cards.iter().enumerate() {
                    let position = position_key(&c.fen);
                    if !seen.insert(position.clone()) {
                        continue;
                    }
                    match existing.get(&position) {
                        Some((fen, answer, card, ord, false))
                            if *fen == c.fen && *answer == c.answer && *card == c.card =>
                        {
                            if *ord != i as i64 {
                                reorder.execute(params![deck, position, i as i64])?;
                            }
                        }
                        _ => {
                            upsert.execute(params![
                                deck, position, c.fen, c.answer, c.card, i as i64, now
                            ])?;
                        }
                    }
                }
                let mut delete = tx.prepare(
                    "UPDATE cards SET deleted = 1, dirty = 1, updated_at = ?3
                     WHERE deck = ?1 AND position = ?2",
                )?;
                for (position, (.., deleted)) in &existing {
                    if !deleted && !seen.contains(position) {
                        delete.execute(params![deck, position, now])?;
                    }
                }
            }
            tx.commit()
        })
    }

    /// Appends reviews to the deck's log.
    pub fn append_reviews(&self, deck: &str, reviews: &[TrainingReview]) -> Result<(), Error> {
        let now = now_ms();
        self.with_conn(|conn| {
            let tx = conn.transaction()?;
            {
                let mut insert = tx.prepare(
                    "INSERT INTO reviews (deck, position, fen, log, reviewed_at, uid, dirty)
                     VALUES (?1, ?2, ?3, ?4, ?5, lower(hex(randomblob(16))), 1)",
                )?;
                for r in reviews {
                    insert.execute(params![deck, position_key(&r.fen), r.fen, r.log, now])?;
                }
            }
            tx.commit()
        })
    }

    /// Changes not uploaded yet, at most `limit` cards and `limit` reviews.
    pub fn pending(&self, limit: u32) -> Result<TrainingPending, Error> {
        self.with_conn(|conn| {
            let cards = conn
                .prepare(
                    "SELECT deck, position, fen, answer, card, ord, updated_at, deleted
                     FROM cards WHERE dirty = 1 LIMIT ?1",
                )?
                .query_map([limit], |r| {
                    Ok(SyncCard {
                        deck: r.get(0)?,
                        position: r.get(1)?,
                        fen: r.get(2)?,
                        answer: r.get(3)?,
                        card: r.get(4)?,
                        ord: r.get::<_, i64>(5)?.max(0) as u32,
                        updated_at: r.get::<_, i64>(6)? as f64,
                        deleted: r.get(7)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            let reviews = conn
                .prepare(
                    "SELECT uid, deck, fen, log, reviewed_at
                     FROM reviews WHERE dirty = 1 ORDER BY id LIMIT ?1",
                )?
                .query_map([limit], |r| {
                    Ok(SyncReview {
                        uid: r.get(0)?,
                        deck: r.get(1)?,
                        fen: r.get(2)?,
                        log: r.get(3)?,
                        reviewed_at: r.get::<_, i64>(4)? as f64,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(TrainingPending { cards, reviews })
        })
    }

    /// Marks uploaded changes as synced. A card changed again since its
    /// upload (other `updated_at`) stays dirty.
    pub fn mark_synced(&self, cards: &[SyncCardKey], reviews: &[String]) -> Result<(), Error> {
        self.with_conn(|conn| {
            let tx = conn.transaction()?;
            {
                let mut card = tx.prepare(
                    "UPDATE cards SET dirty = 0
                     WHERE deck = ?1 AND position = ?2 AND updated_at = ?3",
                )?;
                for c in cards {
                    card.execute(params![c.deck, c.position, c.updated_at as i64])?;
                }
                let mut review = tx.prepare("UPDATE reviews SET dirty = 0 WHERE uid = ?1")?;
                for uid in reviews {
                    review.execute([uid])?;
                }
            }
            tx.commit()
        })
    }

    /// Applies changes from the cloud. A card is taken when it is newer
    /// than the local one; reviews are added unless already there.
    /// Returns the decks that changed.
    pub fn apply_remote(
        &self,
        cards: &[SyncCard],
        reviews: &[SyncReview],
    ) -> Result<Vec<String>, Error> {
        self.with_conn(|conn| {
            let tx = conn.transaction()?;
            let mut changed = BTreeSet::new();
            {
                let mut local = tx.prepare(
                    "SELECT updated_at FROM cards WHERE deck = ?1 AND position = ?2",
                )?;
                let mut upsert = tx.prepare(
                    "INSERT INTO cards (deck, position, fen, answer, card, ord, updated_at, deleted, dirty)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0)
                     ON CONFLICT (deck, position) DO UPDATE SET
                         fen = excluded.fen, answer = excluded.answer, card = excluded.card,
                         ord = excluded.ord, updated_at = excluded.updated_at,
                         deleted = excluded.deleted, dirty = 0",
                )?;
                let mut known =
                    tx.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES (?1, ?2)")?;
                for c in cards {
                    let remote = c.updated_at as i64;
                    let current: Option<i64> = local
                        .query_row(params![c.deck, c.position], |r| r.get(0))
                        .map(Some)
                        .or_else(|e| match e {
                            rusqlite::Error::QueryReturnedNoRows => Ok(None),
                            e => Err(e),
                        })?;
                    if current.is_some_and(|t| t >= remote) {
                        continue;
                    }
                    upsert.execute(params![
                        c.deck, c.position, c.fen, c.answer, c.card, c.ord, remote, c.deleted
                    ])?;
                    known.execute(params![format!("deck:{}", c.deck), remote.to_string()])?;
                    changed.insert(c.deck.clone());
                }
                let mut insert = tx.prepare(
                    "INSERT OR IGNORE INTO reviews (deck, position, fen, log, reviewed_at, uid, dirty)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)",
                )?;
                for r in reviews {
                    let added = insert.execute(params![
                        r.deck,
                        position_key(&r.fen),
                        r.fen,
                        r.log,
                        r.reviewed_at as i64,
                        r.uid
                    ])?;
                    if added > 0 {
                        changed.insert(r.deck.clone());
                    }
                }
            }
            tx.commit()?;
            Ok(changed.into_iter().collect())
        })
    }

    /// Moves all decks of repertoire `from` (also `from#<game>`) to the
    /// repertoire id `to`, when a local repertoire takes over the id it has
    /// in the cloud. Moved data is marked for upload.
    pub fn rename_repertoire(&self, from: &str, to: &str) -> Result<(), Error> {
        if from == to {
            return Ok(());
        }
        self.with_conn(|conn| {
            let tx = conn.transaction()?;
            let pattern = format!("{}#%", from.replace('%', "\\%").replace('_', "\\_"));
            let new_deck = "?2 || substr(deck, length(?1) + 1)";
            tx.execute(
                &format!(
                    "UPDATE OR IGNORE cards SET deck = {new_deck}, dirty = 1
                     WHERE deck = ?1 OR deck LIKE ?3 ESCAPE '\\'"
                ),
                params![from, to, pattern],
            )?;
            tx.execute(
                "DELETE FROM cards WHERE deck = ?1 OR deck LIKE ?2 ESCAPE '\\'",
                params![from, pattern],
            )?;
            tx.execute(
                &format!(
                    "UPDATE reviews SET deck = {new_deck}, dirty = 1
                     WHERE deck = ?1 OR deck LIKE ?3 ESCAPE '\\'"
                ),
                params![from, to, pattern],
            )?;
            tx.execute(
                &format!(
                    "UPDATE OR IGNORE meta SET key = 'deck:' || {}
                     WHERE key = 'deck:' || ?1 OR key LIKE 'deck:' || ?3 ESCAPE '\\'",
                    "?2 || substr(key, length(?1) + 6)"
                ),
                params![from, to, pattern],
            )?;
            tx.commit()
        })
    }

    /// Small values the sync keeps on this device (cursors, last hashes).
    pub fn meta_get(&self, key: &str) -> Result<Option<String>, Error> {
        self.with_conn(|conn| {
            conn.query_row(
                "SELECT value FROM meta WHERE key = ?1",
                [format!("sync:{key}")],
                |r| r.get(0),
            )
            .map(Some)
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(None),
                e => Err(e),
            })
        })
    }

    /// Sets a sync value; `None` removes it.
    pub fn meta_set(&self, key: &str, value: Option<&str>) -> Result<(), Error> {
        self.with_conn(|conn| {
            let key = format!("sync:{key}");
            match value {
                Some(v) => conn.execute(
                    "INSERT INTO meta (key, value) VALUES (?1, ?2)
                     ON CONFLICT (key) DO UPDATE SET value = excluded.value",
                    params![key, v],
                )?,
                None => conn.execute("DELETE FROM meta WHERE key = ?1", [key])?,
            };
            Ok(())
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

#[tauri::command]
#[specta::specta]
pub async fn training_pending(
    limit: u32,
    state: tauri::State<'_, AppState>,
) -> Result<TrainingPending, Error> {
    state.training.pending(limit)
}

#[tauri::command]
#[specta::specta]
pub async fn training_mark_synced(
    cards: Vec<SyncCardKey>,
    reviews: Vec<String>,
    state: tauri::State<'_, AppState>,
) -> Result<(), Error> {
    state.training.mark_synced(&cards, &reviews)
}

#[tauri::command]
#[specta::specta]
pub async fn training_apply_remote(
    cards: Vec<SyncCard>,
    reviews: Vec<SyncReview>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<String>, Error> {
    state.training.apply_remote(&cards, &reviews)
}

#[tauri::command]
#[specta::specta]
pub async fn training_rename_repertoire(
    from: String,
    to: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), Error> {
    state.training.rename_repertoire(&from, &to)
}

#[tauri::command]
#[specta::specta]
pub async fn sync_meta_get(
    key: String,
    state: tauri::State<'_, AppState>,
) -> Result<Option<String>, Error> {
    state.training.meta_get(&key)
}

#[tauri::command]
#[specta::specta]
pub async fn sync_meta_set(
    key: String,
    value: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<(), Error> {
    state.training.meta_set(&key, value.as_deref())
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

    fn sync_card(deck: &str, fen: &str, answer: &str, updated_at: f64, deleted: bool) -> SyncCard {
        SyncCard {
            deck: deck.into(),
            position: position_key(fen),
            fen: fen.into(),
            answer: answer.into(),
            card: "{}".into(),
            ord: 0,
            updated_at,
            deleted,
        }
    }

    #[test]
    fn unchanged_cards_are_not_uploaded_again() {
        let store = TrainingStore::open_in_memory();
        store.save_cards("rep1", &[card(START, "e5", 0)]).unwrap();
        let pending = store.pending(100).unwrap();
        assert_eq!(pending.cards.len(), 1);
        let keys: Vec<_> = pending
            .cards
            .iter()
            .map(|c| SyncCardKey {
                deck: c.deck.clone(),
                position: c.position.clone(),
                updated_at: c.updated_at,
            })
            .collect();
        store.mark_synced(&keys, &[]).unwrap();
        store.save_cards("rep1", &[card(START, "e5", 0)]).unwrap();
        assert!(store.pending(100).unwrap().cards.is_empty());
        store.save_cards("rep1", &[card(START, "e5", 1)]).unwrap();
        assert_eq!(store.pending(100).unwrap().cards.len(), 1);
    }

    #[test]
    fn removed_cards_become_deletion_marks() {
        let store = TrainingStore::open_in_memory();
        store.save_cards("rep1", &[card(START, "e5", 0)]).unwrap();
        store.save_cards("rep1", &[]).unwrap();
        assert!(store.load("rep1").unwrap().unwrap().cards.is_empty());
        let pending = store.pending(100).unwrap();
        assert_eq!(pending.cards.len(), 1);
        assert!(pending.cards[0].deleted);
    }

    #[test]
    fn newer_remote_cards_win() {
        let store = TrainingStore::open_in_memory();
        store.save_cards("rep1", &[card(START, "e5", 0)]).unwrap();
        let local = store.pending(100).unwrap().cards[0].updated_at;

        let older = sync_card("rep1", START, "c5", local - 1.0, false);
        assert!(store.apply_remote(&[older], &[]).unwrap().is_empty());
        assert_eq!(store.load("rep1").unwrap().unwrap().cards[0].answer, "e5");

        let newer = sync_card("rep1", START, "c5", local + 1.0, false);
        assert_eq!(store.apply_remote(&[newer], &[]).unwrap(), vec!["rep1"]);
        assert_eq!(store.load("rep1").unwrap().unwrap().cards[0].answer, "c5");
        assert!(store.pending(100).unwrap().cards.is_empty());

        let gone = sync_card("rep1", START, "c5", local + 2.0, true);
        store.apply_remote(&[gone], &[]).unwrap();
        assert!(store.load("rep1").unwrap().unwrap().cards.is_empty());
    }

    #[test]
    fn remote_cards_create_unknown_decks() {
        let store = TrainingStore::open_in_memory();
        store
            .apply_remote(&[sync_card("rep9", START, "e5", 5.0, false)], &[])
            .unwrap();
        assert_eq!(store.load("rep9").unwrap().unwrap().cards.len(), 1);
    }

    #[test]
    fn reviews_sync_once() {
        let store = TrainingStore::open_in_memory();
        store
            .append_reviews(
                "rep1",
                &[TrainingReview {
                    fen: START.into(),
                    log: "{}".into(),
                }],
            )
            .unwrap();
        let pending = store.pending(100).unwrap().reviews;
        assert_eq!(pending.len(), 1);
        let uid = pending[0].uid.clone();
        assert_eq!(uid.len(), 32);
        store.mark_synced(&[], &[uid.clone()]).unwrap();
        assert!(store.pending(100).unwrap().reviews.is_empty());

        // The same review coming back from the cloud is not added twice.
        assert!(store.apply_remote(&[], &pending).unwrap().is_empty());
        let other = SyncReview {
            uid: "b".repeat(32),
            ..pending[0].clone()
        };
        assert_eq!(store.apply_remote(&[], &[other]).unwrap(), vec!["rep1"]);
        assert_eq!(store.load("rep1").unwrap().unwrap().reviews.len(), 2);
    }

    #[test]
    fn renaming_moves_all_games_of_a_repertoire() {
        let store = TrainingStore::open_in_memory();
        store.save_cards("old", &[card(START, "e5", 0)]).unwrap();
        store.save_cards("old#2", &[card(START, "c5", 0)]).unwrap();
        store.save_cards("older", &[card(START, "d5", 0)]).unwrap();
        store
            .append_reviews(
                "old#2",
                &[TrainingReview {
                    fen: START.into(),
                    log: "{}".into(),
                }],
            )
            .unwrap();
        store.rename_repertoire("old", "new").unwrap();
        assert!(store.load("old").unwrap().is_none());
        assert_eq!(store.load("new").unwrap().unwrap().cards[0].answer, "e5");
        let game2 = store.load("new#2").unwrap().unwrap();
        assert_eq!(game2.cards[0].answer, "c5");
        assert_eq!(game2.reviews.len(), 1);
        assert_eq!(store.load("older").unwrap().unwrap().cards[0].answer, "d5");
    }

    #[test]
    fn sync_meta_round_trip() {
        let store = TrainingStore::open_in_memory();
        assert_eq!(store.meta_get("cursor").unwrap(), None);
        store.meta_set("cursor", Some("42")).unwrap();
        store.meta_set("cursor", Some("43")).unwrap();
        assert_eq!(store.meta_get("cursor").unwrap().as_deref(), Some("43"));
        store.meta_set("cursor", None).unwrap();
        assert_eq!(store.meta_get("cursor").unwrap(), None);
    }

    #[test]
    fn schema_1_is_migrated() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE cards (deck TEXT NOT NULL, position TEXT NOT NULL, fen TEXT NOT NULL,
                 answer TEXT NOT NULL, card TEXT NOT NULL, ord INTEGER NOT NULL,
                 updated_at INTEGER NOT NULL, PRIMARY KEY (deck, position)) WITHOUT ROWID;
             CREATE TABLE reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, deck TEXT NOT NULL,
                 position TEXT NOT NULL, fen TEXT NOT NULL, log TEXT NOT NULL,
                 reviewed_at INTEGER NOT NULL);
             CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             INSERT INTO meta VALUES ('schema_version', '1');
             INSERT INTO cards VALUES ('rep1', 'p', 'p 0 1', 'e5', '{}', 0, 100);
             INSERT INTO reviews (deck, position, fen, log, reviewed_at)
                 VALUES ('rep1', 'p', 'p 0 1', '{}', 100);",
        )
        .unwrap();
        let mut conn = conn;
        migrate(&mut conn).unwrap();
        let store = TrainingStore::default();
        *store.inner.lock().unwrap() = Some(conn);
        let pending = store.pending(10).unwrap();
        assert_eq!(pending.cards[0].updated_at, 100_000.0);
        assert_eq!(pending.reviews[0].reviewed_at, 100_000.0);
        assert_eq!(pending.reviews[0].uid.len(), 32);
    }
}
