# Where Showdown winners go, by game phase

Recorded from the Teams' Bots Showdown broadcast (`wss://watch.joinbuilders.org/live`) on Sat Nov 21, 2026: 6 full matches (5 PM block matches 1, 2, 6; 6 PM block matches 1, 2, 3). Winners: azing 3, TigerTown27 2, W squad 1. Positions are exact x, y, z from the stream (x east, y north, metres from the `arena/v2/world.json` origin), sampled every 2 s.

"Top 3" = places 1–3 in each match (18 mech-matches); "Winner" = place 1 only. Clusters are k-means on top-3 positions in each phase, with k picked by silhouette (3–7). Radius = 80th percentile distance of members. Lift = top-3 time share in the circle divided by the whole field's time share in the same circle (above 1 means winners over-use it). "Matches" = how many of the 6 matches had a top-3 mech in that cluster, so 1/6 clusters are one-offs.

![clusters](winner-clusters.png)

## Headline

**Spawn / early (0–60 s).** Winners move away from spawn fast (winner median 9.0 m/s vs 4.6 for places 4–16) and keep more space (nearest mech 164 m vs 129 m). They gather in three places that show up across matches:
1. Dulles / University Hall, centre-east (160, 51), r ≈ 100 m. 5 of 6 matches, lift 2.6.
2. Smith Substation / west of the Oval toward PAES (−86, −4), r ≈ 90 m. 4 of 6, a third of winner time.
3. East edge past Derby / Hayes Hall (365, −88), r ≈ 115 m. 3 of 6, a third of winner time.

**Mid game (60–180 s).** This is when winners take roofs: 16% of winner time and 11% of top-3 time on roofs (feet above 9 m), against 2% for everyone else. They also sit closer to the zone edge (margin 0.37 vs 0.50) while keeping more distance from others (142 m vs 111 m).
1. University Hall / Independence Hall core (123, 0), r ≈ 100 m. All 6 matches, the most-used spot.
2. Caldwell Lab block, north (125, 185), r ≈ 145 m. 4 of 6, 29% of winner time.
3. Derby Hall rooftop, east (345, 21), r ≈ 95 m. 4 of 6, 46% roof.
4. Faculty Club / Orton Hall, south-east (313, −208), r ≈ 85 m. Lift 2.1, 27% roof, but only 2 of 6 matches.

**End game (180 s+).** The final zone always closed in the centre-east band (final centres x 55–256, y −107–77), so end-game spots follow the zone. Inside it, winners differ by height and spacing, not by being nearer the centre: 27% of winner time on roofs vs 0% for places 4–16, nearest mech 107 m vs 80 m, and zone margin is the same (0.46 vs 0.47).
1. Thompson Library south side (162, −168), r ≈ 80 m. 38% of winner time, 24% roof.
2. University Hall (170, 0), r ≈ 65 m. 4 of 6.
3. Townshend Hall (47, −73), r ≈ 60 m.
4. Bricker Hall roofs (279, −30), r ≈ 75 m, 28% roof.

**Cross-check with Dylan's top-5 profiles** (`/mnt/project-files/match-data/mech-top5-bot-profiles.md`): it agrees. azing is described as a rooftop sniper that gets more aggressive late, and TigerTown27 as fast and always moving; here the winner group is the fastest early, and roof use climbs from 4% to 16% to 27% across the phases. Dylan's numbers have no x, y, so the location clusters are new.

**Caveats.** 6 matches is a small sample, so treat 1/6 and 2/6 clusters as hints. Spawn points are random, so the early clusters mix "where they spawned" with "where they went"; the speed numbers show they do move. Zone placement is random each match, so for the end game the roof and spacing rules generalise better than exact coordinates.

## Tables

### Spawn / early (0–60 s)

k = 7 clusters (silhouette 0.544), 540 top-3 samples at 2 s.

| # | Centre (x, y) m | Radius m | Near | Top-3 time | Winner time | Field time | Lift | Matches | Roof | Zone margin |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 160, 51 | 101 | Dulles Hall (32 m), University Hall (57 m) | 24% | 4% | 9% | 2.61 | 5/6 | 5% | 0.69 |
| 2 | 365, -88 | 115 | Derby Hall (112 m), Hayes Hall (133 m) | 21% | 32% | 9% | 2.34 | 3/6 | 9% | 0.36 |
| 3 | -86, -4 | 91 | Smith Electrical Substation (68 m), Physical Activity and Education Services (92 m) | 20% | 33% | 8% | 2.44 | 4/6 | 1% | 0.71 |
| 4 | -83, 289 | 79 | Tuttle Park Place Garage (47 m), Knowlton Hall (68 m) | 11% | 0% | 4% | 3.03 | 2/6 | 0% | 0.3 |
| 5 | 226, 293 | 96 | Physics Research Building (39 m), Chemical & Biomolecular Engineering Building (56 m) | 10% | 29% | 4% | 2.72 | 2/6 | 0% | 0.26 |
| 6 | 105, -221 | 86 | Lazenby Hall (57 m), Campbell Hall (82 m) | 9% | 2% | 5% | 1.72 | 1/6 | 0% | 0.68 |
| 7 | -329, 204 | 111 | Stadium Lot Northwest (57 m), Ohio Stadium (91 m) | 5% | 0% | 1% | 3.81 | 1/6 | 7% | 0.17 |

| Group | Roof share | Zone margin | Median speed m/s | Stationary share | Nearest mech m |
|---|---|---|---|---|---|
| Winner (1st) | 4% | 0.41 | 9.03 | 17% | 164 |
| Top 3 | 4% | 0.59 | 6.0 | 24% | 142 |
| Places 4–16 | 3% | 0.5 | 4.61 | 27% | 129 |

### Mid game (60–180 s)

k = 6 clusters (silhouette 0.484), 1080 top-3 samples at 2 s.

| # | Centre (x, y) m | Radius m | Near | Top-3 time | Winner time | Field time | Lift | Matches | Roof | Zone margin |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 123, -0 | 102 | University Hall (61 m), Independence Hall (62 m) | 26% | 8% | 16% | 1.63 | 6/6 | 2% | 0.55 |
| 2 | 125, 185 | 146 | Caldwell Laboratory (4 m), Scott Laboratory (83 m) | 23% | 29% | 19% | 1.17 | 4/6 | 5% | 0.37 |
| 3 | 345, 21 | 93 | Derby Hall (7 m), Denney Hall (70 m) | 15% | 5% | 10% | 1.52 | 4/6 | 46% | 0.36 |
| 4 | -218, -48 | 188 | Physical Activity and Education Services (100 m), Smith Electrical Substation (168 m) | 13% | 24% | 14% | 0.96 | 4/6 | 0% | 0.35 |
| 5 | 76, -227 | 87 | Lazenby Hall (30 m), Campbell Hall (67 m) | 12% | 9% | 9% | 1.32 | 3/6 | 0% | 0.43 |
| 6 | 313, -208 | 84 | Faculty Club (45 m), Orton Hall (83 m) | 11% | 25% | 5% | 2.06 | 2/6 | 27% | 0.36 |

| Group | Roof share | Zone margin | Median speed m/s | Stationary share | Nearest mech m |
|---|---|---|---|---|---|
| Winner (1st) | 16% | 0.37 | 4.53 | 28% | 142 |
| Top 3 | 11% | 0.42 | 3.2 | 42% | 125 |
| Places 4–16 | 2% | 0.5 | 4.12 | 39% | 111 |

### End game (180 s+)

k = 7 clusters (silhouette 0.453), 759 top-3 samples at 2 s.

| # | Centre (x, y) m | Radius m | Near | Top-3 time | Winner time | Field time | Lift | Matches | Roof | Zone margin |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 162, -168 | 82 | William Oxley Thompson Memorial Library (41 m), Mirror Lake (110 m) | 25% | 38% | 17% | 1.48 | 3/6 | 24% | 0.6 |
| 2 | 170, 0 | 66 | University Hall (14 m), Dulles Hall (75 m) | 22% | 15% | 21% | 1.05 | 4/6 | 5% | 0.5 |
| 3 | 47, -73 | 62 | Townshend Hall (21 m), Wilce Student Health Center (54 m) | 15% | 8% | 10% | 1.39 | 3/6 | 0% | 0.51 |
| 4 | 279, -30 | 74 | Bricker Hall (47 m), Derby Hall (90 m) | 12% | 6% | 14% | 0.81 | 3/6 | 28% | 0.48 |
| 5 | 66, 78 | 75 | Central Service Building (94 m), Independence Hall (95 m) | 11% | 18% | 11% | 1.03 | 5/6 | 1% | 0.38 |
| 6 | -72, 89 | 79 | Smith Electrical Substation (33 m), Central Service Building (50 m) | 11% | 4% | 7% | 1.57 | 2/6 | 2% | 0.39 |
| 7 | 32, 263 | 31 | Northwest Garage (12 m), Tuttle Park Place Garage (85 m) | 4% | 12% | 3% | 1.55 | 1/6 | 87% | 0.12 |

| Group | Roof share | Zone margin | Median speed m/s | Stationary share | Nearest mech m |
|---|---|---|---|---|---|
| Winner (1st) | 27% | 0.46 | 4.03 | 33% | 107 |
| Top 3 | 14% | 0.48 | 2.55 | 41% | 97 |
| Places 4–16 | 0% | 0.47 | 4.57 | 30% | 80 |

## Files

- `raw/showdown-<block>-m<match>-<seed>.json`: one per match. Zone schedule, final placings (place, kills, death time, loadout, damage) and a 2 s track per mech `[t_s, x, y, z, hp]`.
- `cluster.py`: rebuilds `summary.json` and `winner-clusters.png` from `raw/`. `make_md.py` renders the tables.
- Run: `pip install scikit-learn matplotlib numpy && python3 analysis/winner-positions/cluster.py && python3 analysis/winner-positions/make_md.py`
