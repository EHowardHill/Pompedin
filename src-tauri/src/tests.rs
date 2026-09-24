// tests.rs — unit tests for the save-safety and export helpers.
// (Command functions that need a Tauri AppHandle are covered by the
// integration smoke test scaffold in tests/integration/.)

use crate::export::write_frame_png;
use crate::project_io::{backup_path, rotate_backups, write_atomic};
use std::fs;
use std::path::{Path, PathBuf};

fn temp_project_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "pompedin_test_{tag}_{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("failed to create test dir");
    dir
}

#[test]
fn backup_path_appends_bak_suffix() {
    let p = Path::new("project.json");
    assert_eq!(backup_path(p, 1), PathBuf::from("project.json.bak1"));
    assert_eq!(backup_path(p, 3), PathBuf::from("project.json.bak3"));
}

#[test]
fn rotate_backups_keeps_last_three_good_writes() {
    let dir = temp_project_dir("rotate");
    let main = dir.join("p.json");

    // Five saves in a row; rotate before each write, like the real
    // save commands do. After N saves the newest 3 previous versions
    // must survive as .bak1..bak3 and nothing older.
    for round in 1..=5 {
        rotate_backups(&main);
        fs::write(&main, format!("v{round}")).unwrap();
    }

    assert_eq!(fs::read_to_string(&main).unwrap(), "v5");
    assert_eq!(fs::read_to_string(backup_path(&main, 1)).unwrap(), "v4");
    assert_eq!(fs::read_to_string(backup_path(&main, 2)).unwrap(), "v3");
    assert_eq!(fs::read_to_string(backup_path(&main, 3)).unwrap(), "v2");
    assert!(!backup_path(&main, 4).exists(), "must cap at 3 backups");
    assert!(!main.with_extension("tmp").exists());

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn rotate_backups_is_a_noop_when_nothing_exists() {
    let dir = temp_project_dir("rotate_empty");
    let main = dir.join("p.json");
    rotate_backups(&main); // must not panic
    assert!(!main.exists());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn write_atomic_replaces_destination_and_leaves_no_tmp() {
    let dir = temp_project_dir("atomic");
    let target = dir.join("p.json");

    write_atomic(&target, "first").unwrap();
    assert_eq!(fs::read_to_string(&target).unwrap(), "first");

    write_atomic(&target, "second").unwrap();
    assert_eq!(fs::read_to_string(&target).unwrap(), "second");

    let leftovers: Vec<_> = fs::read_dir(&dir)
        .unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.file_name()
                .to_string_lossy()
                .ends_with(".tmp")
        })
        .collect();
    assert!(leftovers.is_empty(), "no temp files may survive a save");

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn write_atomic_fails_cleanly_for_missing_directory() {
    let dir = temp_project_dir("atomic_missing");
    let target = dir.join("does_not_exist").join("p.json");
    assert!(write_atomic(&target, "data").is_err());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn write_frame_png_writes_indexed_frames() {
    let dir = temp_project_dir("mp4frame");
    write_frame_png(&dir, 7, b"png-bytes").unwrap();
    assert_eq!(fs::read(dir.join("frame_0007.png")).unwrap(), b"png-bytes");

    write_frame_png(&dir, 123, b"more-bytes").unwrap();
    assert!(dir.join("frame_0123.png").exists());
    // Frame indices are zero-padded to 4 digits so FFmpeg's sequence
    // glob picks them up in order.
    assert!(!dir.join("frame_7.png").exists());

    let _ = fs::remove_dir_all(&dir);
}
