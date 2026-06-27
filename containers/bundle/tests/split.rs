use magna_carta_bundle::split::split_file_into_volumes;

#[test]
fn splits_into_ordered_parts_that_concatenate_back() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("archive.7z");
    std::fs::write(&path, (0u8..=255).cycle().take(2500).collect::<Vec<_>>()).unwrap();
    let parts = split_file_into_volumes(&path, 1000).unwrap();
    assert_eq!(parts.len(), 3); // 1000 + 1000 + 500
    assert!(parts[0].to_string_lossy().ends_with(".001"));
    assert!(parts[2].to_string_lossy().ends_with(".003"));
    let joined: Vec<u8> = parts
        .iter()
        .flat_map(|p| std::fs::read(p).unwrap())
        .collect();
    assert_eq!(joined, std::fs::read(&path).unwrap());
}

#[test]
fn exact_multiple_yields_no_trailing_empty_part() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("archive.7z");
    std::fs::write(&path, vec![9u8; 2000]).unwrap();
    let parts = split_file_into_volumes(&path, 1000).unwrap();
    assert_eq!(
        parts.len(),
        2,
        "2000/1000 must be exactly 2 parts, no empty tail"
    );
    assert_eq!(std::fs::metadata(&parts[0]).unwrap().len(), 1000);
    assert_eq!(std::fs::metadata(&parts[1]).unwrap().len(), 1000);
}

#[test]
fn one_byte_over_yields_a_one_byte_tail() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("archive.7z");
    std::fs::write(&path, vec![3u8; 1001]).unwrap();
    let parts = split_file_into_volumes(&path, 1000).unwrap();
    assert_eq!(parts.len(), 2);
    assert_eq!(std::fs::metadata(&parts[1]).unwrap().len(), 1);
}

#[test]
fn empty_file_yields_one_empty_001_part() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("empty.7z");
    std::fs::write(&path, b"").unwrap();
    let parts = split_file_into_volumes(&path, 1000).unwrap();
    assert_eq!(parts.len(), 1);
    assert!(parts[0].to_string_lossy().ends_with(".001"));
    assert_eq!(std::fs::metadata(&parts[0]).unwrap().len(), 0);
}

#[test]
fn small_file_still_yields_one_001_part() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("a.7z");
    std::fs::write(&path, b"tiny").unwrap();
    let parts = split_file_into_volumes(&path, 1_000_000).unwrap();
    assert_eq!(parts.len(), 1);
    assert!(parts[0].to_string_lossy().ends_with(".001"));
}
