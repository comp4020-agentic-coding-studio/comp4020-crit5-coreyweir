# Process overview

## What I built

I built Asterion, a 3D / 2.5D (3D map, movement in 2D but can turn) maze grid survival game with procedurally
generated levels, lives, and score
with a hunger mechanic, a sword powerup, and a minotaur that functions both as a threat and a
potential food source, as well as score. The most basic strategy would be to take the most direct
possible path to the goal while avoiding the minotaur. More advanced players will keep track of where
sword power-ups are and attempt to maximise their score by collecting as much food as possible, using the
minotaur as a food source.

## The moments that mattered

- one commit: [`a1b2c3d`](https://github.com/YOUR-ORG/YOUR-REPO/commit/a1b2c3d)
- a range:
  [`a1b2c3d...e4f5a6b`](https://github.com/YOUR-ORG/YOUR-REPO/compare/a1b2c3d...e4f5a6b)

The first completed iteration of the game *worked*, but it felt very clunky. The forwards movement felt very discrete as opposed to
continuous, and playing the game it felt that you frequently needed to look left and right rapidly to check if the coast was clear. It
felt like the game made you more likely to die, not through anything you did incorrectly, but through the combination of what was visible
to you and how you interacted with the world. I considered adding some sort of transition as you moved into new corridors that functioned as
a pause and gave you a view of your surroundings: it would've fit with the 2.5D angle (transitioning to a new plane of play), but before committing
to it I decided to keep it simple. I asked Claude to fix the jumpiness of the movement, to widen the FoV so you could actually see more of your surroundings
without turning, and to add a 180 degree turn button so you could more quickly check behind you. These changes landed in
[`5da3e34`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-coreyweir/commit/5da3e34). While they didn't resolve all of my issues, the wider FoV
did help, and the easier 180 also helped. I thus decided that I was on the right track, and instead of adding gimmicks like animations, I needed to continue
addressing the fundamentals: the camera, the map, the control scheme.

Playing the updated version, I realised the problem was how we were handling the weird 2.5D / 3D mixture: it wasn't
easy to quickly examine the space without free camera control, and there were too many turns. With discrete movement in four directions only, it was incredibly important
that we got the ratio of straights to turns right. Too many and the game would feel clunky and they'd be frustrating instead of suspenseful. Too few and the game could
become boring. Additionally, the lack of sound cues made the game significantly less engaging and made it feel like you were playing with your hands behind your back.
Accordingly, I encouraged Claude to allow free camera control up 90 degrees left or right (like turning your head)—including while moving—but to lock to the appropriate
discrete direction on the next keypress. I also encouraged Opus to increase the granularity of the coordinates, so a quick W press resulted in a small movement. I also
asked it to add sound cues, and to make our 'world 1-1' equivalent feel more space constrained like the rest of the levels (so as to avoid the free camera movement becoming
counter-intuitive), plus add a 'world 1-2' where the sword and minotaur are introduced. The idea was to introduce all the gameplay mechanics early on, so that they didn't
become frustration inducing the first time a player encountered them in later levels. Simultaneously, I asked Claude to try to improve on that 'straight to turn' ratio, as well
as to make the UI more intuitive. The idea behind this prompt was: great, the game is playable, the mechanics all work; now, we need to add the polish that take it from
'technically playable' to 'engaging and enjoyable'. The results of this prompt landed in
[`7f6e715`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-coreyweir/commit/7f6e715). Playing the
updated game, I knew I was on the right track: the sound effects made it feel more engaging, the improved early levels and UI made the game feel all the more intuitive, and the
updated step size felt much better. That said, I was way off on the camera control: it didn't work, at all. And the game still felt far too hard. Accordingly, I asked Claude
to remove the free camera control, make S run after doing the 180 (so the player had some chance of escaping a minotaur), further slow the minotaur relative to the player,
and add a minimap to avoid cornering. These changes landed in
[`7f6e715...1392528`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-coreyweir/compare/7f6e715...1392528), and playing the updated game I was finally happy with it.
