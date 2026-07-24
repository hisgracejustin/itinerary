1. check ../nav for how it gets latest fx rates and come up with a plan for what we can do to have latest rates for the approx hkd calculations. no need to store a lot of historical fx rates unless you see a reason to? so we store a week's worth in db table or what?
2. the pages like costs, settle up, settings, on desktop look really weird, they're wasting a lot of horizontal space as they take like a fixed width and have their own scrollbar where ive to be in the section. fix up 
3. for placeholder people with no google email login, ive added them by their email, is there a way i can let them login with a pin/password of sorts? how would that work- one time or would it persist, etc. since its not oauth?
4. Costs page has no trip filter chips like the others. add. — ✅ done 2026-07-24
5. needs attention list: remove the pin emoji, use something more aesthetic — ✅ done 2026-07-24
in the side bar, version number is 0.1.0, use the git short commit sha instead
6. allow users, when they log in to change their avatar. options are in public/icons/, frogs of different varieties. can be user specific, same for all trips if they set one.
7. on the costs page, would be great if clicking on a cost would open up the booking popup so i can view/edit, etc. like on their normal pages. no new ui just reusing — ✅ done 2026-07-24