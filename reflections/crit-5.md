# Reflection

## 1. What was the breakthrough that moved the work forward?
The 'breakthrough' was going back and forth with Claude to figure out the right gameplay mechanics.
I knew going in that I wanted to try something 3D or 2.5D, was open to doing a Super Mario Bros platformer
or a Pacman inspired survival maze grid game, but didn't want to produce a rip-off or a clone. I spent just under
1.5 hours going back and forth with Claude. Collaboratively, we determined three.js was the right tool for the job.
At first, it tried to discourage going so ambitious, and pushed me towards a rotating plane to get an object through a
hole while avoiding spikes: interesting mechanic, but felt very slop. It also tried to encourage something where you run
automatically, reading too much into the spec saying the game teaches itself, and suggesting expecting the player to try pressing
W was too much to ask and counter to the spec. After pushing back, we got into a groove of going back and forth. It regularly suggested
ideas that would've led to broken gameplay mechanics that gave a simple meta or weren't intuitive (e.g. the 'food' emits light, darkness
is what kills you, and your health bar and score are the same: counter-intuitive—why would darkness kill you?—and gives a meta where you
just sprint towards the goal every time). But by pushing back and building on Claude's idea, we landed on the eventual design.

## 2. What did this work change about who I want to be as a software developer?
It made me want to be the sort of developer that spends real time thinking about how a user will interact with the product. Where are the pitfalls?
What's counter-intuitive? How can we make the design feel intuitive, and minimise necessary explanation? How can we make the product feel so natural
that, while you can learn how to use it most efficiently, you don't need to learn how to use it to get started? I want to spend real time thinking about
these aspects of the UX, instead of just defaulting to 'this is a common pattern, the user is likely familiar with it, execute on that and provide some
documentation where required'.
