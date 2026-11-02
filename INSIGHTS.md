# Three things the map explorer helped us notice

These findings use the cleaned telemetry from **796 matches and 798 recorded player sessions**, with match starts from February 9–14, 2026 UTC. They point to experiments a level designer can start with. We still need to test whether these changes improve the experience or encourage players to play again.

## 1. AmbroseValley: make the riskier route worth taking

**What caught my eye**

Players spent roughly the same amount of time in a southern area and an area around the central river. The southern area recorded more looting and far fewer deaths caused by bots. That raises a question: what makes the dangerous route worth choosing?

**Data**

Both selected areas are 100 × 100 world units. All dates are included.

| Measurement | Southern area | Central river area |
|---|---:|---:|
| Recorded player time | 4.01 player-hours | 4.07 player-hours |
| Loot events | 1,102 | 753 |
| Deaths caused by bots | 3 | 43 |
| Bot-caused deaths per player-hour | 0.75 | 10.56 |

The southern area has **46.3% more loot events**. The central area has about **14.1 times as many bot-caused deaths per player-hour**. Comparing deaths per hour accounts for time spent in each area.

The selected world-coordinate bounds are:

- Southern area: X from −70 to 30; Z from −373 to −273.
- Central river area: X from −70 to 30; Z from −73 to 27.

Loot counts do not tell us what the items were worth. The centre might already offer fewer but better pickups. These figures alone cannot tell us whether the reward matches the risk.

**What to try**

Compare the equipment and rewards in both areas. If the central route offers little extra value for its danger, test moving a small amount of valuable loot toward it. Keep bots and the layout unchanged so the test measures the effect of moving loot.

Preserve the safer route as a valid option. The aim is to give players a reason to choose either route, depending on how much risk they want to take.

**What to measure**

- **Route choice:** visits to each area and the routes players take across repeated matches.
- **Reward and danger:** useful equipment or reward value collected, loot events per player-minute, and bot-caused deaths per player-hour.
- **Player experience:** whether players feel the dangerous route offers a worthwhile reward.
- **Game outcome:** whether players who try the change start another match and return on later days.

More visits to the centre are only useful if players find the risk worthwhile and the safer route remains a good option.

**Why a level designer should care**

Loot placement shapes route choice. Giving players good reasons to take different routes could keep the map interesting over repeated matches.

## 2. GrandRift: give players room to learn the central fights

**What caught my eye**

Combat deaths cluster along the Mine Pit–Cave House corridor, and player paths frequently cross it. This makes the corridor a useful place to check whether players have enough warning, cover and room to retreat.

**Data**

The selected corridor covers world X from −90 to 10 and world Z from −90 to 110. Across all **59 GrandRift matches**:

| Measurement | Selected corridor | Rest of the map |
|---|---:|---:|
| Combat deaths | 17 | 8 |
| Recorded player time | 1.91 player-hours | 4.45 player-hours |
| Combat deaths per player-hour | 8.90 | 1.80 |

The corridor contains **68% of combat deaths**, with **30.1% of player time**. Its combat-death rate is about **five times higher** than outside it. Player paths cross the corridor in **45 of 59 matches (76.3%)**.

This is a small sample, and a dangerous central route may be intentional. The cluster gives us a place to inspect, but does not prove the fights are unfair.

**What to try**

Use replay to inspect approaches to the death locations. Check when players can first see the threat, what cover they can reach, and whether they can leave a bad position.

If an approach leaves players exposed with few options, test adding one piece of cover. Keep loot and bots unchanged. If players instead need an escape route, test that separately.

**What to measure**

- **Fight outcomes:** deaths on approach, combat deaths per player-hour, and successful retreats.
- **Player choices:** use of the new cover or connection and changes in approach across repeated visits.
- **Player experience:** whether players understand how they died and what they could try differently.
- **Game outcome:** whether players choose another match after a loss in the corridor and return to try it again.

Keep the corridor challenging, but give players ways to improve with practice. Fewer deaths alone would not prove the change helped.

**Why a level designer should care**

Players use this corridor in most recorded matches, so a small layout change could matter often. A designer can adjust cover, views of approaching threats and escape routes, then test whether the fights reward learning.

## 3. Lockdown: check whether scarce loot adds tension or frustration

**What caught my eye**

Players record fewer loot events per hour on Lockdown than on either other map. Scarce loot could make the map tense. It could also mean players spend too long searching or struggle to find useful equipment before a fight.

**Data**

These rates include all dates and player-side loot events:

| Map | Recorded player sessions | Loot events | Player-hours | Loot events per player-hour |
|---|---:|---:|---:|---:|
| AmbroseValley | 568 | 9,902 | 61.81 | 160.2 |
| GrandRift | 59 | 880 | 6.36 | 138.4 |
| Lockdown | 171 | 2,047 | 19.52 | 104.9 |

Lockdown's looting rate is **34.5% lower than AmbroseValley** and **24.2% lower than GrandRift**. Of the **55 identified players recorded on both Lockdown and AmbroseValley**, **41 (74.5%)** loot less frequently on Lockdown. Many of the same players loot less often on Lockdown, though other differences between their matches could still explain this.

Fewer loot events do not necessarily mean worse equipment. We need item types and values to find out whether players are getting what they need.

**What to try**

First, confirm whether scarcity is part of Lockdown's intended experience. Inspect opening routes and check the useful equipment available before nearby encounters.

If useful equipment is too hard to reach and that is unintended, test moving a little existing loot to a spot that is easier to see and reach early in the match. Keep the items and total supply unchanged. Test quantity or quality separately if access does not explain the problem.

If scarce loot is intentional, check whether players still have useful choices and find the search worthwhile. Fewer pickups may suit that experience.

**What to measure**

- **Access:** time to first useful loot, time between loot events, and loot events per player-hour.
- **Preparation and survival:** weapons, ammunition and healing available at the first encounter; deaths before useful equipment is collected; confirmed extraction outcomes.
- **Player experience:** whether players feel prepared and whether the rewards justify the time spent searching.
- **Game outcome:** whether more players choose another match and return on later days without losing the map's intended tension.

Keep the change if it helps players prepare for fights and makes searching worthwhile. More pickups alone would not show that.

**Why a level designer should care**

A designer can change how easy loot is to see and reach. Test whether Lockdown's current layout creates tense choices or just a long search, and whether players want to return.

## How the figures were calculated

These figures use the cleaned data described in [DATA_QUALITY.md](DATA_QUALITY.md). We read the match index (`web/public/data/manifest.json`) and the map/day files it lists. Only player tracks count, including numeric-ID sessions identified as players. Each session counts separately, even when the same player appears again.

To reproduce the figures, run `make data`, then `node scripts/verify-insights.mjs`. The [check script](scripts/verify-insights.mjs) uses the explorer's calculations.

Player time comes from the Traffic calculation:

- The path uses position samples, plus loot and kill events between the first and last sample, in recorded order. Replay draws the same path.
- Time between points is spread along the straight line joining them. Rows after death add no time.
- The last position sample adds no time unless the first death comes later at exactly the same world position. That wait counts too: 43 sessions and 1,275 seconds in this data.
- A player-hour is 3,600 seconds of recorded time, added across players.

Area totals use a grid with cells four world units wide, before any colors are blended for display. The selected boundaries follow cell edges. A match counts as crossing an area when a player's trail intersects the selected rectangle.

Combat deaths include player-side `BotKilled` and `Killed`, and exclude storm deaths. Repeated events kept by the cleaning rules still count. Tables round values for display; rates and percentage differences use the full values.

The data supports these findings about locations, event counts and player time. It does not tell us how useful items were, whether players were ready for fights, whether retreats worked or whether players enjoyed the match. It has no extraction event, and a session ending without a death cannot be treated as a successful extraction. Testing the proposed benefits needs complete match start and end records, confirmed extractions, equipment details and player feedback.

Compare each changed map with the current version using similar player groups. Record the map version, player experience and repeat visits. Before testing, decide how soon a player must start another match or return on a later day to count. These are possible benefits to test; this dataset does not establish them.
