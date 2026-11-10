//! Run one conversion from the command line: `cargo run --release --example transcode_file -- in out`.
//! For checking the engine against real files by hand; the service itself is `src/main.rs`.

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut arguments = std::env::args().skip(1);
    let (Some(source), Some(output)) = (arguments.next(), arguments.next()) else {
        return Err("usage: transcode_file <source> <output.mp4>".into());
    };
    let working = tempfile::tempdir()?;
    let started = std::time::Instant::now();
    let report = magna_carta_transcode::transcode::transcode(
        source.as_ref(),
        working.path(),
        output.as_ref(),
    )?;
    println!("{report:?} seconds={:.2}", started.elapsed().as_secs_f64());
    Ok(())
}
