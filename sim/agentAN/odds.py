# Noise-model checks for the builders-4 real scores (agentAN, Nov 22 ~5:45 AM)
import random, math, statistics as st
from math import erf, sqrt
R = random.Random(1)
Phi = lambda z: 0.5 * (1 + erf(z / sqrt(2)))
fix = [5.81, 5.59, 5.59, 5.54, 5.46]
gap = fix[0] - st.mean(fix[1:])
print("t36 minus mean(t37..t40) =", round(gap, 3))
for s in (0.08, 0.10, 0.13):
    n = 200000; hit = 0
    for _ in range(n):
        x = sorted(R.gauss(0, s) for _ in range(5))
        if x[-1] - st.mean(x[:-1]) >= gap: hit += 1
    print(f"sigma {s}: P(top of 5 identical builds sits >= {gap:.3f} above the other four) = {hit/n:.3f}")
# shrinkage estimate of t36 level: y0 ~ N(mu, s^2); y_i ~ N(mu, s^2 + tau^2)
for s in (0.08, 0.10, 0.13):
    for tau in (0.05, 0.10):
        w0 = 1 / s**2; wi = 1 / (s**2 + tau**2)
        mu = (w0 * fix[0] + wi * sum(fix[1:])) / (w0 + 4 * wi)
        d = [round((y - mu) * tau**2 / (s**2 + tau**2), 3) for y in fix[1:]]
        print(f"sigma {s} tau {tau}: t36 level {mu:.3f}; posterior effects t37,t38a,t39,t40 {d}")
# lottery: chance that the best of N new builds beats a bar
print("\nP(one draw > bar) and P(best of N > bar)")
for mu in (5.60, 5.65, 5.70, 5.75):
    for s in (0.08, 0.10, 0.13):
        row = []
        for bar in (5.81, 5.90, 6.00):
            p = 1 - Phi((bar - mu) / s)
            row.append(f"{bar}: {p*100:4.1f}% / N8 {(1-(1-p)**8)*100:4.1f}% / N12 {(1-(1-p)**12)*100:4.1f}%")
        print(f"mu {mu} s {s} | " + " | ".join(row))
