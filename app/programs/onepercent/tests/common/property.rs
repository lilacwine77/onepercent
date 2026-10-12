//! Runs the requested total case count across independent, reproducible workers.
use proptest::{
    strategy::Strategy,
    test_runner::{Config, FileFailurePersistence, RngSeed, TestCaseResult, TestRunner},
};

pub fn parallel<S, Make, Run>(source: &'static str, make: Make, run: Run)
where
    S: Strategy,
    Make: Fn() -> S + Sync,
    Run: Fn(S::Value) -> TestCaseResult + Sync,
{
    parallel_named(source, source, make, run);
}

pub fn parallel_named<S, Make, Run>(
    source: &'static str,
    identity: &'static str,
    make: Make,
    run: Run,
) where
    S: Strategy,
    Make: Fn() -> S + Sync,
    Run: Fn(S::Value) -> TestCaseResult + Sync,
{
    let config = Config::default();
    let total = config.cases;
    let configured_workers = std::env::var("M1_PROPTEST_THREADS")
        .ok()
        .map(|s| {
            s.parse::<u32>()
                .expect("M1_PROPTEST_THREADS must be a positive integer")
        })
        .unwrap_or(8);
    assert!(configured_workers > 0);
    let workers = configured_workers.min(total.max(1));
    let seed = match config.rng_seed {
        RngSeed::Fixed(seed) => seed,
        RngSeed::Random => {
            let timestamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            timestamp as u64 ^ u64::from(std::process::id())
        }
    };
    eprintln!("{identity}: {total} cases, {workers} workers, PROPTEST_RNG_SEED={seed}");
    let start = std::time::Instant::now();
    std::thread::scope(|scope| {
        let mut handles = Vec::new();
        for worker in 0..workers {
            let cases = total / workers + u32::from(worker < total % workers);
            let seed = seed.wrapping_add(u64::from(worker).wrapping_mul(0x9e37_79b9_7f4a_7c15));
            // Each worker owns its persistence file; concurrent failures cannot
            // overwrite another worker's minimal reproducible input.
            let path: &'static str = Box::leak(
                format!(
                    "{}/tests/{}.worker-{worker}.proptest-regressions",
                    env!("CARGO_MANIFEST_DIR"),
                    std::path::Path::new(identity)
                        .file_name()
                        .unwrap()
                        .to_str()
                        .unwrap()
                )
                .into_boxed_str(),
            );
            let worker_config = Config {
                cases,
                rng_seed: RngSeed::Fixed(seed),
                source_file: Some(source),
                failure_persistence: Some(Box::new(FileFailurePersistence::Direct(path))),
                ..config.clone()
            };
            let make = &make;
            let run = &run;
            handles.push(scope.spawn(move || {
                let mut runner = TestRunner::new(worker_config);
                let completed = std::cell::Cell::new(0u32);
                let result = runner.run(&make(), |value| {
                    let result = run(value);
                    if result.is_ok() {
                        let count = completed.get() + 1;
                        completed.set(count);
                        if count.is_multiple_of(25) {
                            eprintln!(
                                "{identity}: worker {worker}, {count}/{cases} passed, elapsed {:?}",
                                start.elapsed()
                            );
                        }
                    }
                    result
                });
                eprintln!(
                    "{identity}: worker {worker}, {cases} cases, seed {seed}, elapsed {:?}",
                    start.elapsed()
                );
                assert!(result.is_ok(), "worker {worker}, seed {seed}: {result:?}");
            }));
        }
        for handle in handles {
            handle.join().expect("property worker failed");
        }
    });
    eprintln!(
        "{identity}: all {total} cases passed in {:?}",
        start.elapsed()
    );
}
