2. the pages like costs, settle up, settings, on desktop look really weird, they're wasting a lot of horizontal space as they take like a fixed width and have their own scrollbar where ive to be in the section. fix up — ✅ done 2026-07-24
6. in the side bar, version number is 0.1.0, use the git short commit sha instead — ✅ done 2026-07-24
7. allow users, when they log in to change their avatar. options are in public/icons/, frogs of different varieties. can be user specific, same for all trips if they set one. — ✅ done 2026-07-24
11. in settings page, maybe have a separate people card/section on top cause trips share people and each trip card should only be about adding/removing people from a trip. people section on top can be for their pin, rename, etc. and maybe then i could add people to trips from a dropdown list of already exisitng people also instead of just email — ✅ done 2026-07-24

1. check ../nav for how it gets latest fx rates and come up with a plan for what we can do to have latest rates for the approx hkd calculations. no need to store a lot of historical fx rates unless you see a reason to? so we store a week's worth in db table or what? — ✅ done 2026-07-24
10. sometimes a usd transaction once charged has a known fx rate it was charged at. i may want to edit and add that and then i would expect that be paid off in hkd at that rate. how could we support that? plan with me. — ✅ done 2026-07-24
3. for placeholder people with no google email login, ive added them by their email, is there a way i can let them login with a pin/password of sorts? how would that work- one time or would it persist, etc. since its not oauth? — ✅ done 2026-07-24
4. Costs page has no trip filter chips like the others. add. — ✅ done 2026-07-24
5. needs attention list: remove the pin emoji, use something more aesthetic — ✅ done 2026-07-24
8. on the costs page, would be great if clicking on a cost would open up the booking popup so i can view/edit, etc. like on their normal pages. no new ui just reusing — ✅ done 2026-07-24
9. for a split say 15061 by 4 people (or 2 groups) for flights, what if some part of that say 447 was baggage that only 1 person used. is there a way to attribute an extra there to one or some people and persist that so the final amount is 447 attributed to them, and 15061-447 divided by the rest if equal split, etc.  — ✅ done 2026-07-24
