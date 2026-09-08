# seven-zip-core test fixtures

Tiny, non-sensitive 7z archives the TypeScript wrapper's tests (`packages/seven-zip/test/`)
read. The Rust tests do not use them — they build their own archives in memory — so these exist only
because a Vitest test cannot run a 7z encoder.

Every one of them was written by `sevenz-rust2`'s own encoder, which is the same encoder
`containers/bundle` uses to write the 7z bundles people download. Nothing here was hand-assembled,
so a test that lists one back is testing the format rather than a belief about it.

| File                     | What it is                                                                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `mixed-members.7z`       | Four members: a file with a modification time, a directory, and two nested paths. The encoder compressed the file list, so listing it takes three ranged reads.                      |
| `many-members.7z`        | 400 members with repetitive names — a compressed file list big enough that a truncation or a cap has somewhere to bite.                                                              |
| `content-encrypted.7z`   | AES-256 content with the file list in the clear, and small enough that the encoder stored the list uncompressed: listable member by member in two ranged reads, none of it openable. |
| `file-list-encrypted.7z` | 400 members, AES-256, with the file list encrypted too. Cannot be listed without the password; the listing refuses it by name.                                                       |

Whether a file list ends up compressed is the encoder's call, not a setting — it stores the list raw
when compressing it would not save anything. That is why the two-range path is covered by the small
archive and the three-range path by the larger ones.

Password, where there is one: `correct horse battery staple`.

Regenerate all four with

```
cargo test -p seven-zip-core -- --ignored regenerate_typescript_fixtures
```

The generator lives in `../integration.rs` beside the tests, and its output is deterministic, so a
regeneration that changes a byte means the encoder changed.
