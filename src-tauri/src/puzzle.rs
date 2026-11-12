use std::{
    collections::VecDeque,
    fs::remove_file,
    path::{Path, PathBuf},
    sync::Mutex,
};

use duckdb::{params, AccessMode, Config, Connection};
use once_cell::sync::Lazy;
use serde::Serialize;
use specta::Type;

use crate::{db::Puzzle, error::Error};

fn is_legacy_database(path: &Path) -> Result<bool, std::io::Error> {
    let mut header = [0; 16];
    std::io::Read::read_exact(&mut std::fs::File::open(path)?, &mut header)?;
    Ok(&header == b"SQLite format 3\0")
}

pub(crate) fn open_database(path: &Path) -> Result<Connection, Error> {
    if is_legacy_database(path)? {
        return Err(std::io::Error::other(
            "This puzzle database uses the old SQLite format. Download the latest DuckDB puzzle database.",
        ).into());
    }
    Ok(Connection::open_with_flags(
        path,
        Config::default().access_mode(AccessMode::ReadOnly)?,
    )?)
}

static PUZZLE_CACHE: Lazy<Mutex<PuzzleCache>> = Lazy::new(|| Mutex::new(PuzzleCache::new()));

#[derive(Debug)]
struct PuzzleCache {
    cache: VecDeque<Puzzle>,
    file: String,
    min_rating: u16,
    max_rating: u16,
    theme: Option<String>,
}

impl PuzzleCache {
    fn new() -> Self {
        Self {
            cache: VecDeque::new(),
            file: String::new(),
            min_rating: 0,
            max_rating: 0,
            theme: None,
        }
    }

    fn get_puzzles(
        &mut self,
        file: &str,
        min_rating: u16,
        max_rating: u16,
        theme: &Option<String>,
    ) -> Result<(), Error> {
        if self.cache.is_empty()
            || self.min_rating != min_rating
            || self.max_rating != max_rating
            || self.theme != *theme
            || self.file != file
        {
            self.cache.clear();
            let db = open_database(Path::new(file))?;
            let mut query = String::from(
                "SELECT p.id, p.fen, p.moves, p.rating, p.rating_deviation, p.popularity, p.nb_plays
                 FROM puzzles p WHERE p.rating BETWEEN ? AND ?",
            );
            if theme.is_some() {
                query.push_str(
                    " AND EXISTS (SELECT 1 FROM puzzle_themes pt
                      JOIN themes t ON t.id = pt.theme_id
                      WHERE pt.puzzle_id = p.id AND t.name = ?)",
                );
            }
            query.push_str(" ORDER BY random() LIMIT 20");
            let mut statement = db.prepare(&query)?;
            let read_puzzle = |row: &duckdb::Row<'_>| {
                Ok(Puzzle {
                    id: row.get(0)?,
                    fen: row.get(1)?,
                    moves: row.get(2)?,
                    rating: row.get(3)?,
                    rating_deviation: row.get(4)?,
                    popularity: row.get(5)?,
                    nb_plays: row.get(6)?,
                })
            };
            let rows = if let Some(theme_name) = theme {
                statement.query_map(
                    params![i32::from(min_rating), i32::from(max_rating), theme_name],
                    read_puzzle,
                )?
            } else {
                statement.query_map(
                    params![i32::from(min_rating), i32::from(max_rating)],
                    read_puzzle,
                )?
            };
            self.cache = rows.collect::<Result<_, _>>()?;
            self.file = file.to_owned();
            self.min_rating = min_rating;
            self.max_rating = max_rating;
            self.theme = theme.clone();
        }

        Ok(())
    }

    fn get_next_puzzle(&mut self) -> Option<Puzzle> {
        self.cache.pop_front()
    }
}

/// Drops the puzzles held ready from `file`, after its contents changed.
pub fn forget_cached_puzzles(file: &Path) {
    let mut cache = PUZZLE_CACHE.lock().unwrap();
    if Path::new(&cache.file) == file {
        cache.cache.clear();
    }
}

#[tauri::command]
#[specta::specta]
pub fn get_puzzle(
    file: String,
    min_rating: u16,
    max_rating: u16,
    theme: Option<String>,
) -> Result<Puzzle, Error> {
    let mut cache = PUZZLE_CACHE.lock().unwrap();
    cache.get_puzzles(&file, min_rating, max_rating, &theme)?;
    cache.get_next_puzzle().ok_or(Error::NoPuzzles)
}

#[derive(Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PuzzleDatabaseInfo {
    title: String,
    description: String,
    puzzle_count: i32,
    storage_size: u64,
    path: String,
}

#[tauri::command]
#[specta::specta]
pub async fn get_puzzle_db_info(file: PathBuf) -> Result<Option<PuzzleDatabaseInfo>, Error> {
    database_info(file)
}

fn database_info(path: PathBuf) -> Result<Option<PuzzleDatabaseInfo>, Error> {
    match is_legacy_database(&path) {
        Ok(true) => {
            delete_puzzle_database(path.to_string_lossy().into_owned())?;
            return Ok(None);
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
        Ok(false) => {}
    }
    let db = open_database(&path)?;
    let puzzle_count = db.query_row("SELECT COUNT(*) FROM puzzles", [], |row| row.get(0))?;

    let storage_size = path.metadata()?.len();
    let filename = path.file_name().expect("get filename").to_string_lossy();

    Ok(Some(PuzzleDatabaseInfo {
        title: filename.to_string(),
        description: "".to_string(),
        puzzle_count,
        storage_size,
        path: path.to_string_lossy().to_string(),
    }))
}

#[tauri::command]
#[specta::specta]
pub fn delete_puzzle_database(file: String) -> Result<(), Error> {
    let mut cache = PUZZLE_CACHE.lock().unwrap();
    match remove_file(&file) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }
    if cache.file == file {
        cache.cache.clear();
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn get_puzzle_themes(file: String) -> Result<Vec<String>, Error> {
    let db = open_database(Path::new(&file))?;
    let mut statement = db.prepare("SELECT name FROM themes ORDER BY name")?;
    let result = statement
        .query_map([], |row| row.get(0))?
        .collect::<Result<_, _>>()?;
    Ok(result)
}

#[tauri::command]
#[specta::specta]
pub fn get_themes_for_puzzle(file: String, puzzle_id: i32) -> Result<Vec<String>, Error> {
    let db = open_database(Path::new(&file))?;
    let mut statement = db.prepare(
        "SELECT t.name FROM themes t JOIN puzzle_themes pt ON t.id = pt.theme_id
         WHERE pt.puzzle_id = ? ORDER BY t.name",
    )?;
    let result = statement
        .query_map([puzzle_id], |row| row.get(0))?
        .collect::<Result<_, _>>()?;
    Ok(result)
}

/// Where Lichess publishes its puzzle database (CC0), updated monthly.
const LICHESS_PUZZLE_URL: &str = "https://database.lichess.org/lichess_db_puzzle.csv.zst";

/// Counts the bytes read from the underlying file, to report import progress.
struct CountingReader<R> {
    inner: R,
    read: std::sync::Arc<std::sync::atomic::AtomicU64>,
}

impl<R: std::io::Read> std::io::Read for CountingReader<R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let n = self.inner.read(buf)?;
        self.read
            .fetch_add(n as u64, std::sync::atomic::Ordering::Relaxed);
        Ok(n)
    }
}

fn invalid_data(message: impl Into<String>) -> Error {
    std::io::Error::new(std::io::ErrorKind::InvalidData, message.into()).into()
}

/// Builds a puzzle database at `dest` from the Lichess puzzle CSV at `source`
/// (`lichess_db_puzzle.csv`, plain or zstd-compressed).
///
/// The table layout is the one the puzzle trainer already reads, with the
/// Lichess id, game link and opening tags kept as extra columns.
/// `on_progress` gets the share of the source file read so far, from 0 to 1.
/// Returns the number of imported puzzles.
fn import_lichess_csv(
    source: &Path,
    dest: &Path,
    mut on_progress: impl FnMut(f32),
) -> Result<usize, Error> {
    use std::io::{BufReader, Read, Seek, SeekFrom};
    use std::sync::{atomic::AtomicU64, atomic::Ordering, Arc};

    let mut file = std::fs::File::open(source)?;
    let total = file.metadata()?.len().max(1);
    let mut magic = [0u8; 4];
    let is_zstd = file.read_exact(&mut magic).is_ok() && magic == [0x28, 0xB5, 0x2F, 0xFD];
    file.seek(SeekFrom::Start(0))?;

    let read = Arc::new(AtomicU64::new(0));
    let counting = CountingReader {
        inner: file,
        read: read.clone(),
    };
    let input: Box<dyn Read> = if is_zstd {
        Box::new(zstd::stream::read::Decoder::new(counting)?)
    } else {
        Box::new(BufReader::new(counting))
    };
    let mut csv = csv::ReaderBuilder::new()
        .has_headers(true)
        .flexible(true)
        .from_reader(input);

    let headers = csv.headers().map_err(|e| invalid_data(e.to_string()))?;
    if headers.get(0) != Some("PuzzleId") || headers.get(1) != Some("FEN") {
        return Err(invalid_data(
            "This is not a Lichess puzzle file (lichess_db_puzzle.csv or .csv.zst).",
        ));
    }

    if dest.exists() {
        remove_file(dest)?;
    }
    let db = Connection::open(dest)?;
    db.execute_batch(
        "CREATE TABLE puzzles (
            id INTEGER PRIMARY KEY,
            fen VARCHAR NOT NULL,
            moves VARCHAR NOT NULL,
            rating INTEGER NOT NULL,
            rating_deviation INTEGER NOT NULL,
            popularity INTEGER NOT NULL,
            nb_plays INTEGER NOT NULL,
            lichess_id VARCHAR,
            game_url VARCHAR,
            opening_tags VARCHAR,
            theme_list VARCHAR
        );",
    )?;

    let mut count: usize = 0;
    {
        let mut appender = db.appender("puzzles")?;
        let mut record = csv::StringRecord::new();
        while csv
            .read_record(&mut record)
            .map_err(|e| invalid_data(e.to_string()))?
        {
            let field = |i: usize| record.get(i).unwrap_or("");
            let number = |i: usize| field(i).parse::<i32>().unwrap_or(0);
            if field(1).is_empty() || field(2).is_empty() {
                continue;
            }
            count += 1;
            appender.append_row(params![
                count as i32,
                field(1),
                field(2),
                number(3),
                number(4),
                number(5),
                number(6),
                field(0),
                field(8),
                field(9),
                field(7),
            ])?;
            if count % 20_000 == 0 {
                on_progress((read.load(Ordering::Relaxed) as f32 / total as f32).min(1.0));
            }
        }
        appender.flush()?;
    }
    on_progress(1.0);

    db.execute_batch(
        "CREATE TABLE themes AS
            SELECT CAST(row_number() OVER (ORDER BY name) AS INTEGER) AS id, name
            FROM (SELECT DISTINCT unnest(string_split(theme_list, ' ')) AS name FROM puzzles)
            WHERE name <> '';
         CREATE TABLE puzzle_themes AS
            SELECT p.id AS puzzle_id, t.id AS theme_id
            FROM (SELECT id, unnest(string_split(theme_list, ' ')) AS name FROM puzzles) p
            JOIN themes t ON t.name = p.name
            ORDER BY p.id;
         ALTER TABLE puzzles DROP COLUMN theme_list;
         CHECKPOINT;",
    )?;
    Ok(count)
}

/// Imports the Lichess puzzle database into `dest`.
///
/// `source` is a local `lichess_db_puzzle.csv(.zst)`; without it the file is
/// downloaded from database.lichess.org first. Progress goes to the progress
/// bar `id`: the first half is the download, the second half the import.
#[tauri::command]
#[specta::specta]
pub async fn import_lichess_puzzles(
    id: String,
    source: Option<PathBuf>,
    dest: PathBuf,
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::AppState>,
) -> Result<i32, Error> {
    use crate::progress::update_progress;
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;

    let part = dest.with_extension("part");
    let download = dest.with_extension("csv.zst.download");
    let downloaded = source.is_none();

    let result: Result<usize, Error> = async {
        let source = match source {
            Some(source) => source,
            None => {
                let client = reqwest::Client::builder()
                    .user_agent(concat!("JBLBase/", env!("CARGO_PKG_VERSION")))
                    .build()?;
                let res = client
                    .get(LICHESS_PUZZLE_URL)
                    .send()
                    .await?
                    .error_for_status()?;
                let total = res.content_length();
                let mut out = tokio::fs::File::create(&download).await?;
                let mut stream = res.bytes_stream();
                let mut done: u64 = 0;
                let mut last = -1.0f32;
                while let Some(chunk) = stream.next().await {
                    let chunk = chunk?;
                    out.write_all(&chunk).await?;
                    done += chunk.len() as u64;
                    if let Some(total) = total {
                        let progress = (done as f32 / total.max(1) as f32 * 50.0).min(50.0);
                        if progress - last >= 0.5 {
                            last = progress;
                            update_progress(
                                &state.progress_state,
                                &app,
                                id.clone(),
                                progress,
                                false,
                            )?;
                        }
                    }
                }
                out.flush().await?;
                download.clone()
            }
        };

        let (start, span) = if downloaded {
            (50.0, 49.0)
        } else {
            (1.0, 98.0)
        };
        tokio::task::block_in_place(|| {
            let mut last = -1.0f32;
            import_lichess_csv(&source, &part, |share| {
                // 100 % stands for the last step, building the theme tables.
                let progress = if share >= 1.0 {
                    100.0
                } else {
                    start + share * span
                };
                if progress - last >= 0.5 {
                    last = progress;
                    let _ =
                        update_progress(&state.progress_state, &app, id.clone(), progress, false);
                }
            })
        })
    }
    .await;

    let _ = remove_file(&download);
    let count = match result {
        Ok(count) => count,
        Err(error) => {
            let _ = remove_file(&part);
            state.progress_state.remove(&id);
            return Err(error);
        }
    };

    // Swap the finished database in, replacing an older import.
    {
        let mut cache = PUZZLE_CACHE.lock().unwrap();
        if dest.exists() {
            remove_file(&dest)?;
        }
        std::fs::rename(&part, &dest)?;
        if Path::new(&cache.file) == dest {
            cache.cache.clear();
        }
    }
    update_progress(&state.progress_state, &app, id, 100.0, true)?;
    Ok(count as i32)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags
00008,r6k/pp2r2p/4Rp1Q/3p4/8/1N1P2R1/PqP2bPP/7K b - - 0 24,f2g3 e6e7 b2b1 b3c1 b1c1 h6c1,1877,76,95,8786,crushing hangingPiece long middlegame,https://lichess.org/787zsVup/black#48,
0000D,5rk1/1p3ppp/pq3b2/8/8/1P1Q1N2/P4PPP/3R2K1 w - - 2 27,d3d6 f8d8 d6d8 f6d8,1500,73,96,34107,advantage endgame short,https://lichess.org/F8M8OS71#53,
0008Q,8/4R3/1p2P3/p4r2/P6p/1P3Pk1/4K3/8 w - - 1 64,e7f7 f5e5 e2f1 e5e6,1296,75,91,632,advantage endgame rookEndgame short,https://lichess.org/MQSyb3KW#127,Kings_Pawn_Game
";

    fn check_import(compressed: bool) {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("puzzles.csv");
        if compressed {
            std::fs::write(&source, zstd::encode_all(SAMPLE.as_bytes(), 3).unwrap()).unwrap();
        } else {
            std::fs::write(&source, SAMPLE).unwrap();
        }
        let dest = dir.path().join("lichess.duckdb");
        let mut last = 0.0;
        let count = import_lichess_csv(&source, &dest, |p| last = p).unwrap();
        assert_eq!(count, 3);
        assert_eq!(last, 1.0);

        let file = dest.to_string_lossy().into_owned();
        let info = database_info(dest.clone()).unwrap().unwrap();
        assert_eq!(info.puzzle_count, 3);

        let themes = get_puzzle_themes(file.clone()).unwrap();
        assert!(themes.contains(&"rookEndgame".to_string()));
        assert_eq!(themes.len(), 8);
        assert_eq!(
            get_themes_for_puzzle(file.clone(), 2).unwrap(),
            vec!["advantage", "endgame", "short"]
        );

        // The trainer's own query: rating range plus theme.
        let mut cache = PuzzleCache::new();
        cache
            .get_puzzles(&file, 1200, 1400, &Some("rookEndgame".to_string()))
            .unwrap();
        let puzzle = cache.get_next_puzzle().unwrap();
        assert_eq!(puzzle.rating, 1296);
        assert_eq!(puzzle.moves, "e7f7 f5e5 e2f1 e5e6");
        assert!(cache.get_next_puzzle().is_none());
    }

    #[test]
    fn imports_plain_lichess_csv() {
        check_import(false);
    }

    #[test]
    fn imports_zstd_lichess_csv() {
        check_import(true);
    }

    /// Timing check with a real file:
    /// `JBLBASE_TEST_PUZZLE_CSV=/path/lichess_db_puzzle.csv.zst cargo test --release -- --ignored imports_real_file --nocapture`
    #[test]
    #[ignore]
    fn imports_real_file() {
        let source = PathBuf::from(std::env::var("JBLBASE_TEST_PUZZLE_CSV").unwrap());
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("lichess.duckdb");
        let start = std::time::Instant::now();
        let count = import_lichess_csv(&source, &dest, |_| {}).unwrap();
        println!(
            "{count} puzzles in {:.1?}, {} MB",
            start.elapsed(),
            dest.metadata().unwrap().len() / 1_000_000
        );
        let file = dest.to_string_lossy().into_owned();
        let start = std::time::Instant::now();
        let mut cache = PuzzleCache::new();
        cache
            .get_puzzles(&file, 1500, 1600, &Some("fork".to_string()))
            .unwrap();
        println!("20 puzzles drawn in {:.1?}", start.elapsed());
        assert!(cache.get_next_puzzle().is_some());
    }

    #[test]
    fn rejects_other_files() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("games.csv");
        std::fs::write(&source, "a,b,c\n1,2,3\n").unwrap();
        let dest = dir.path().join("x.duckdb");
        assert!(import_lichess_csv(&source, &dest, |_| {}).is_err());
        assert!(!dest.exists());
    }
}
