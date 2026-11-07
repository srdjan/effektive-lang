# Bench evidence

Medians in milliseconds. A row is separated when every head run is above (SLOWER) or below (FASTER) every base run. Each M2 run is `deno task bench --quick m2`. The load is the one-minute load average of `uptime`; other projects on the same 14-core machine caused it.

## Run 0a: `30bb1d5` against `37a720f`, sequential, load about 68 to 100

Two base runs, then two head runs, of `deno task bench --quick m1 m2 m6`. A row is flagged when the faster head run is slower than the slower base run by more than the largest noise floor of the row. The load was read with `uptime` during the runs and not saved. The noise floors of the rows were 22 to 2278 percent.

```
size small: 30 declarations, 3 modules, | check base 1.077..1.218 head 1.184..1.478 minHead/maxBase 0.97 floor 681%
size medium: 300 declarations, 7 modules | check base 5.621..7.088 head 8.142..8.175 minHead/maxBase 1.15 floor 165%
size large: 3000 declarations, 52 module | check base 59.858..65.889 head 64.931..126.696 minHead/maxBase 0.99 floor 51%
rows 110, flagged 0
```

## Run 0b: `30bb1d5` against `37a720f`, five runs each, same load

```
size small: 30 | check base 1.168,1.261,1.193,1.218,1.077 head 1.208,1.362,1.222,1.478,1.184 median ratio 1.02
size small: 30 | total base 4.087,4.638,3.895,4.758,3.315 head 3.428,3.904,3.442,4.221,3.457 median ratio 0.85
size medium: 300 | check base 6.312,6.575,5.690,7.088,5.621 head 6.462,6.864,6.480,8.175,8.142 median ratio 1.09
size medium: 300 | total base 21.732,47.747,19.239,29.374,18.745 head 19.829,21.475,19.881,28.886,30.995 median ratio 0.99
size large: 3000 | check base 49.869,52.101,52.794,65.889,59.858 head 58.336,60.459,60.911,126.696,64.931 median ratio 1.15
size large: 3000 | total base 167.848,175.944,177.658,213.998,194.633 head 173.259,182.386,181.184,341.629,194.733 median ratio 1.03
separated slower 0, separated faster 0
```

## Run 1: `30bb1d5` against `37a720f`, alternating, load 6 to 11

```
size small: 30 | lex base 0.073,0.069,0.069,0.067 head 0.072,0.069,0.067,0.067 median ratio 1.00
size small: 30 | parse base 0.224,0.211,0.213,0.206 head 0.224,0.222,0.218,0.218 median ratio 1.04
size small: 30 | index base 0.097,0.094,0.094,0.091 head 0.096,0.093,0.093,0.091 median ratio 0.99
size small: 30 | link base 0.029,0.026,0.027,0.024 head 0.031,0.026,0.027,0.026 median ratio 1.00
size small: 30 | resolve base 0.143,0.138,0.134,0.132 head 0.140,0.138,0.132,0.139 median ratio 1.01
SLOWER size small: 30 | check base 1.091,1.034,1.028,1.052 head 1.268,1.265,1.245,1.230 median ratio 1.20
size small: 30 | lower base 0.315,0.303,0.303,0.296 head 0.310,0.301,0.297,0.296 median ratio 0.99
size small: 30 | emit base 0.621,0.609,0.625,0.585 head 0.672,0.601,0.596,0.599 median ratio 0.97
size small: 30 | validate base 0.849,0.755,0.812,0.750 head 0.886,0.799,0.849,0.796 median ratio 1.05
size small: 30 | total base 3.629,3.275,3.317,3.220 head 3.733,3.497,3.461,3.445 median ratio 1.05
size medium: 300 | lex base 0.469,0.454,0.445,0.460 head 0.442,0.447,0.460,0.470 median ratio 1.00
size medium: 300 | parse base 1.337,1.329,1.323,1.318 head 1.325,1.320,1.339,1.356 median ratio 1.01
size medium: 300 | index base 0.644,0.624,0.628,0.620 head 0.616,0.612,0.622,0.627 median ratio 0.99
size medium: 300 | link base 0.049,0.044,0.042,0.043 head 0.045,0.044,0.048,0.050 median ratio 1.09
size medium: 300 | resolve base 0.861,0.805,0.811,0.816 head 0.828,0.824,0.841,0.878 median ratio 1.03
SLOWER size medium: 300 | check base 5.903,5.463,5.480,5.674 head 6.584,6.672,6.798,6.826 median ratio 1.20
size medium: 300 | lower base 1.955,1.806,1.821,1.816 head 1.801,1.812,1.872,1.940 median ratio 1.03
size medium: 300 | emit base 3.726,3.454,3.422,3.540 head 3.576,3.564,3.757,3.717 median ratio 1.05
size medium: 300 | validate base 5.150,4.849,4.763,4.886 head 5.076,5.058,5.346,5.399 median ratio 1.09
SLOWER size medium: 300 | total base 19.905,18.665,18.545,18.828 head 20.162,20.156,20.740,21.113 median ratio 1.10
size large: 3000 | lex base 4.214,3.932,3.926,4.232 head 3.918,3.893,3.950,4.169 median ratio 0.94
size large: 3000 | parse base 12.525,11.774,11.662,12.513 head 11.768,11.825,12.002,12.400 median ratio 0.96
size large: 3000 | index base 6.213,5.924,5.969,6.259 head 5.816,5.829,5.841,6.160 median ratio 0.94
size large: 3000 | link base 0.166,0.142,0.144,0.160 head 0.136,0.143,0.149,0.151 median ratio 0.93
size large: 3000 | resolve base 8.116,7.380,7.418,7.905 head 7.433,7.508,7.556,7.896 median ratio 0.96
SLOWER size large: 3000 | check base 55.401,48.654,48.994,51.842 head 58.204,59.853,59.562,61.072 median ratio 1.15
size large: 3000 | lower base 16.444,15.711,15.755,16.205 head 15.983,15.770,15.926,16.076 median ratio 0.99
size large: 3000 | emit base 35.607,31.649,31.598,34.627 head 32.038,32.133,32.163,32.986 median ratio 0.93
size large: 3000 | validate base 43.766,40.279,40.991,45.457 head 43.357,43.240,43.000,44.899 median ratio 0.99
size large: 3000 | total base 184.364,162.358,162.519,174.217 head 174.689,176.090,177.492,182.188 median ratio 1.02
separated slower 4, separated faster 0
```

## Bisect 1: medium check stage, two alternating pairs for each step, slow above 1.085

```
75 aab3a26 Remove comments in the emitter that restate the code | base 5.684,5.738 cand 6.711,6.689 ratio 1.173 SLOW
37 ae8831d Share one project driver between a fresh check and a revision | base 5.782,5.378 cand 6.585,6.469 ratio 1.170 SLOW
18 b40a5c5 Give the lexical vocabulary one owner in lex.ts | base 5.657,5.653 cand 5.613,5.696 ratio 1.000 ok
27 574e885 List every expression kind in markCheckedRaw | base 5.624,5.451 cand 5.649,5.439 ratio 1.001 ok
32 339260d Move the configuration reader out of the module loader | base 5.376,5.507 cand 5.414,5.553 ratio 1.008 ok
34 8086a84 Keep the comparison bounds in predicates.ts | base 5.431,5.385 cand 5.423,5.476 ratio 1.008 ok
35 f3ee274 Record UNU6a in the untangle plan | base 5.431,5.404 cand 5.432,5.467 ratio 1.006 ok
36 58aa29f Return the interface identities from the module step | base 5.626,5.774 cand 6.674,6.892 ratio 1.190 SLOW
first slow: 36 58aa29f Return the interface identities from the module step
last ok: f3ee274 Record UNU6a in the untangle plan
```

## Three-way timing, load 4.8 to 6.5

`bisect` is `58aa29f` with its eager payload hash removed. `effektive-lang` is the fixed tree, with the source of `2501e2d`. Each line is one run of the check-only timer: 60 iterations and 15 warm-ups of the medium size.

```
1 base check p25 5.194 median 5.438 p75 5.649 
1 bisect check p25 5.214 median 5.406 p75 5.637 
1 effektive-lang check p25 5.266 median 5.495 p75 5.765 
load 6.53
2 base check p25 5.246 median 5.432 p75 5.631 
2 bisect check p25 5.183 median 5.433 p75 5.674 
2 effektive-lang check p25 5.331 median 5.551 p75 5.811 
load 5.83
3 base check p25 5.209 median 5.462 p75 5.651 
3 bisect check p25 5.156 median 5.436 p75 5.690 
3 effektive-lang check p25 5.302 median 5.512 p75 5.742 
load 5.24
4 base check p25 5.201 median 5.485 p75 5.669 
4 bisect check p25 5.297 median 5.509 p75 5.791 
4 effektive-lang check p25 5.497 median 5.640 p75 5.886 
load 4.82
```

## Bisect 2: `58aa29f..37a720f` without the eager hash, three pairs for each step, slow above 1.009

Inconclusive: `6d376ab` and `ef73b41` have the same `src` and `bench`.

```
56 f25c7ca Remove comments in check_builtins that restate the code | base 5.692,5.579,5.514 cand 5.735,5.58,5.741 ratio 1.016 SLOW
27 6d376ab Record UNU10 and the playground browser check | base 5.472,5.516,5.519 cand 5.518,5.55,5.735 ratio 1.018 SLOW
13 9212709 Load the log schema without the emitter | base 5.579,5.759,5.784 cand 5.629,5.677,5.581 ratio 0.986 ok
20 7a4ae47 Remove the writableModules wrapper | base 5.914,6.36,5.76 cand 5.892,6.044,5.811 ratio 0.984 ok
23 0ff62a8 Keep the hover backend tag through the playground model | base 5.769,5.618,5.398 cand 5.724,5.622,5.435 ratio 1.000 ok
25 9b2fc2c Move the generated-text subscriptions into their own language server module | base 5.537,5.454,5.464 cand 5.366,5.419,5.677 ratio 1.000 ok
26 ef73b41 Share the target-span query and the speculative revision helper | base 5.594,5.495,5.464 cand 5.554,5.456,5.457 ratio 0.995 ok
first slow: 27 6d376ab Record UNU10 and the playground browser check
last ok: ef73b41 Share the target-span query and the speculative revision helper
```

## Run 2: `30bb1d5` against `0198e7c`, alternating, load 15 to 26

```
size small: 30 | lex base 0.071,0.072,0.070,0.077 head 0.083,0.083,0.086,0.071 median ratio 1.15
size small: 30 | parse base 0.215,0.223,0.209,0.230 head 0.255,0.258,0.259,0.228 median ratio 1.16
size small: 30 | index base 0.096,0.096,0.095,0.099 head 0.104,0.106,0.109,0.095 median ratio 1.10
size small: 30 | link base 0.027,0.028,0.026,0.032 head 0.039,0.037,0.040,0.029 median ratio 1.39
size small: 30 | resolve base 0.136,0.140,0.133,0.149 head 0.160,0.158,0.167,0.139 median ratio 1.14
size small: 30 | check base 1.037,1.100,1.007,1.121 head 1.173,1.176,1.227,1.081 median ratio 1.07
size small: 30 | lower base 0.304,0.313,0.291,0.330 head 0.353,0.342,0.351,0.307 median ratio 1.12
size small: 30 | emit base 0.628,0.634,0.614,0.681 head 0.737,0.726,0.714,0.632 median ratio 1.15
size small: 30 | validate base 0.785,0.806,0.790,0.891 head 0.909,0.939,0.973,0.832 median ratio 1.17
size small: 30 | total base 3.355,3.442,3.188,3.664 head 3.944,3.926,4.170,3.424 median ratio 1.15
size medium: 300 | lex base 0.490,0.495,0.441,0.469 head 0.475,0.486,0.709,0.451 median ratio 0.99
size medium: 300 | parse base 1.382,1.413,1.313,1.372 head 1.381,1.400,2.251,1.335 median ratio 1.01
size medium: 300 | index base 0.653,0.666,0.598,0.626 head 0.660,0.652,0.900,0.631 median ratio 1.01
size medium: 300 | link base 0.055,0.058,0.040,0.052 head 0.053,0.054,0.077,0.045 median ratio 0.98
size medium: 300 | resolve base 0.911,0.908,0.808,0.866 head 0.890,0.906,1.497,0.825 median ratio 1.00
size medium: 300 | check base 6.947,6.697,5.443,5.853 head 6.131,6.074,11.674,5.675 median ratio 0.92
size medium: 300 | lower base 2.160,2.200,1.799,2.019 head 1.981,1.972,3.604,1.802 median ratio 0.92
size medium: 300 | emit base 4.393,4.780,3.486,3.940 head 3.869,4.013,7.519,3.528 median ratio 0.91
size medium: 300 | validate base 6.314,6.316,4.780,5.148 head 5.554,5.506,10.002,5.096 median ratio 0.88
size medium: 300 | total base 28.038,25.431,18.525,20.186 head 20.954,20.764,41.221,19.170 median ratio 0.82
size large: 3000 | lex base 4.113,4.055,4.139,3.968 head 4.189,4.007,4.193,3.953 median ratio 1.02
size large: 3000 | parse base 12.401,12.108,12.424,11.711 head 12.834,12.051,12.986,11.925 median ratio 1.03
size large: 3000 | index base 6.088,6.052,6.046,5.721 head 6.180,5.942,6.301,5.853 median ratio 1.02
size large: 3000 | link base 0.151,0.146,0.152,0.143 head 0.154,0.143,0.166,0.139 median ratio 1.02
size large: 3000 | resolve base 7.884,7.623,7.913,7.397 head 7.996,7.497,8.260,7.528 median ratio 1.01
size large: 3000 | check base 52.544,50.700,50.834,48.634 head 54.345,50.621,55.674,50.378 median ratio 1.07
size large: 3000 | lower base 16.455,16.019,16.296,15.708 head 16.889,15.962,16.858,15.968 median ratio 1.03
size large: 3000 | emit base 34.258,33.286,32.901,31.609 head 33.483,32.308,35.195,31.903 median ratio 1.01
SLOWER size large: 3000 | validate base 43.516,42.632,43.172,40.508 head 45.700,43.629,48.443,43.541 median ratio 1.06
size large: 3000 | total base 175.841,168.447,171.964,161.914 head 179.335,169.508,185.669,167.878 median ratio 1.04
separated slower 1, separated faster 0
```

## The check-only timer

```ts
// Times the check stage of the m2 pipeline for the medium size in one tree.
// Usage: deno run -A check_time.ts <tree root> [iterations]
// Prints the median and the quartiles of the check stage, in milliseconds.
const root = Deno.args[0];
const iterations = Number(Deno.args[1] ?? "60");
const m2 = await import(`file://${root}/bench/m2.ts`);
const result = m2.runM2({
  seed: 1,
  sizes: [{
    name: "medium",
    declarations: 300,
    iterations,
    warmups: 15,
    editsPerKind: 0,
  }],
  incremental: false,
});
if (!result.ok) {
  console.log(`failed: ${JSON.stringify(result.error)}`);
  Deno.exit(1);
}
const size = result.value.sizes[0];
const pick = (stage: string) => {
  const row = size.stages.find((s: { stage: string }) => s.stage === stage);
  const sorted = [...row.samples].sort((a: number, b: number) => a - b);
  const at = (q: number) => sorted[Math.floor(q * (sorted.length - 1))];
  return `${stage} p25 ${at(0.25).toFixed(3)} median ${at(0.5).toFixed(3)} p75 ${
    at(0.75).toFixed(3)
  }`;
};
console.log(`${pick("check")} | ${pick("lower")}`);
```
