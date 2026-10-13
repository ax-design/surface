#!/bin/sh
# Runs the baseline matrix for one browser. Usage: sh bench/matrix.sh <browser> <bun> <outdir>
B=$1; BUN=${2:-bun}; OUT=${3:-bench/results}
mkdir -p "$OUT"
for T in 1 4; do
  if [ "$B" = safari ] && [ "$T" = 4 ]; then continue; fi
  "$BUN" bench/run.ts --browser "$B" --throttle "$T" --impls legacy --scenarios sweep,toggle,mount --n 200,1000 > "$OUT/legacy-$B-t$T.json" 2>/dev/null
  "$BUN" bench/run.ts --browser "$B" --throttle "$T" --impls probe --variants final,raw --scenarios toggle,mount --modes experimentalAutoFit --n 200,1000 > "$OUT/probe-$B-t$T.json" 2>/dev/null
done
echo done > "$OUT/DONE-$B"
