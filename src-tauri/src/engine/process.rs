use std::{collections::VecDeque, fmt::Display, path::PathBuf, process::Stdio};

use log::error;
use serde::Serialize;
use specta::Type;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines},
    process::{Child, ChildStdin, ChildStdout, Command},
};
use vampirc_uci::UciMessage;

use crate::error::Error;

use super::{normalize_uci_moves_for_fen, types::GoMode};

#[cfg(target_os = "windows")]
pub const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, Clone, Serialize, Type)]
#[serde(tag = "type", content = "value", rename_all = "camelCase")]
pub enum EngineLog {
    Gui(String),
    Engine(String),
}

pub type EngineReader = Lines<BufReader<ChildStdout>>;

/// Lines kept in an engine's log; a long analysis would otherwise grow it
/// without limit.
const MAX_LOG_LINES: usize = 2000;

pub struct BaseEngine {
    pub stdin: ChildStdin,
    pub reader: Option<EngineReader>,
    #[allow(dead_code)]
    child: Child,
    /// The latest lines to and from the engine, for the log panel (#96).
    logs: VecDeque<EngineLog>,
}

impl BaseEngine {
    pub async fn spawn(path: PathBuf) -> Result<Self, Error> {
        let mut command = Command::new(&path);
        command.current_dir(path.parent().unwrap_or(&path));
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        #[cfg(target_os = "windows")]
        command.creation_flags(CREATE_NO_WINDOW);

        let mut child = command.spawn()?;
        super::reaper::register(&child);

        let stdin = child.stdin.take().ok_or(Error::NoStdin)?;
        let stdout = child.stdout.take().ok_or(Error::NoStdout)?;
        let reader = BufReader::new(stdout).lines();

        if let Some(stderr) = child.stderr.take() {
            tokio::spawn(async move {
                let mut stderr_reader = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = stderr_reader.next_line().await {
                    error!("Engine stderr: {}", line);
                }
            });
        }

        Ok(Self {
            stdin,
            reader: Some(reader),
            child,
            logs: VecDeque::new(),
        })
    }

    pub fn take_reader(&mut self) -> Option<EngineReader> {
        self.reader.take()
    }

    pub fn reader_mut(&mut self) -> Option<&mut EngineReader> {
        self.reader.as_mut()
    }

    fn push_log(&mut self, entry: EngineLog) {
        if self.logs.len() >= MAX_LOG_LINES {
            self.logs.pop_front();
        }
        self.logs.push_back(entry);
    }

    pub fn get_logs(&self) -> Vec<EngineLog> {
        self.logs.iter().cloned().collect()
    }

    fn log_gui(&mut self, cmd: &str) {
        self.push_log(EngineLog::Gui(format!("{}\n", cmd)));
    }

    pub fn log_engine(&mut self, line: &str) {
        self.push_log(EngineLog::Engine(line.to_string()));
    }

    pub async fn init_uci(&mut self) -> Result<(), Error> {
        self.send("uci").await?;
        self.wait_for("uciok").await?;
        self.send("isready").await?;
        self.wait_for("readyok").await?;
        Ok(())
    }

    pub async fn send(&mut self, cmd: &str) -> Result<(), Error> {
        self.log_gui(cmd);
        let msg = format!("{}\n", cmd);
        self.stdin.write_all(msg.as_bytes()).await?;
        Ok(())
    }

    pub async fn wait_for(&mut self, expected: &str) -> Result<(), Error> {
        loop {
            let line = {
                let reader = self.reader.as_mut().ok_or(Error::EngineDisconnected)?;
                reader.next_line().await?
            };
            let Some(line) = line else {
                return Err(Error::EngineDisconnected);
            };
            self.push_log(EngineLog::Engine(line.clone()));
            if line.starts_with(expected) {
                return Ok(());
            }
        }
    }

    pub async fn set_option<T>(&mut self, name: &str, value: T) -> Result<(), Error>
    where
        T: Display,
    {
        let cmd = format!("setoption name {} value {}", name, value);
        self.send(&cmd).await
    }

    pub async fn set_position(&mut self, fen: &str, moves: &[String]) -> Result<(), Error> {
        let normalized_moves = normalize_uci_moves_for_fen(fen, moves)?;
        let cmd = if moves.is_empty() {
            format!("position fen {}", fen)
        } else {
            format!("position fen {} moves {}", fen, normalized_moves.join(" "))
        };
        self.send(&cmd).await
    }

    pub async fn go(&mut self, mode: &GoMode) -> Result<(), Error> {
        let cmd = mode.to_uci_string();
        self.send(&cmd).await
    }

    pub async fn stop(&mut self) -> Result<(), Error> {
        self.send("stop").await
    }

    pub async fn quit(&mut self) -> Result<(), Error> {
        self.send("quit").await
    }

    pub async fn wait_for_bestmove(&mut self) -> Result<String, Error> {
        loop {
            let line = {
                let reader = self.reader.as_mut().ok_or(Error::EngineDisconnected)?;
                reader.next_line().await?
            };
            let Some(line) = line else { break };
            self.push_log(EngineLog::Engine(line.clone()));
            if let UciMessage::BestMove { best_move, .. } = vampirc_uci::parse_one(&line) {
                return Ok(best_move.to_string());
            }
        }
        Err(Error::EngineDisconnected)
    }

    pub fn kill_sync(&mut self) {
        let pid = self.child.id();
        let _ = self.child.start_kill();
        super::reaper::unregister(pid);
    }
}

impl Drop for BaseEngine {
    fn drop(&mut self) {
        self.kill_sync();
    }
}

#[cfg(all(test, unix))]
mod log_tests {
    use super::*;

    #[tokio::test]
    async fn the_log_keeps_only_the_latest_lines() {
        let mut engine = BaseEngine::spawn(PathBuf::from("/bin/cat")).await.unwrap();
        for i in 0..MAX_LOG_LINES + 10 {
            engine.log_engine(&format!("line {i}"));
        }
        let logs = engine.get_logs();
        assert_eq!(logs.len(), MAX_LOG_LINES);
        assert!(matches!(&logs[0], EngineLog::Engine(l) if l == "line 10"));
        engine.kill_sync();
    }
}
