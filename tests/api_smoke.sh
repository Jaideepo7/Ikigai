#!/usr/bin/env bash
# End-to-end smoke test against a running `wrangler dev` (localhost:8787). Fails on first unexpected response.
set -e
B=http://localhost:8787; T=$(mktemp -d); H='content-type: application/json'
u=user$RANDOM; v=user$RANDOM
J() { python -c "import sys,json; d=json.load(sys.stdin); print($1)"; }
req() { curl -s -b "$T/$1" -c "$T/$1" -H "$H" -H 'x-tz: 300' -X "$2" "$B$3" ${4:+-d "$4"}; }
req a POST /api/auth/signup "{\"username\":\"$u\",\"password\":\"secret1\"}" | J "d['ok']" >/dev/null
req b POST /api/auth/signup "{\"username\":\"$v\",\"password\":\"secret1\"}" | J "d['ok']" >/dev/null
[ "$(req a POST /api/auth/signup "{\"username\":\"$u\",\"password\":\"secret1\"}" | J "d['error']")" = "Username taken" ]
req a POST /api/me/character '{"character":3}' >/dev/null
[ "$(req a POST /api/me/character '{"character":4}' | J "d['error']")" = "Character already chosen" ]
[ "$(req a POST /api/me/character '{"character":21}' | J "d['error']")" = "Character already chosen" ]
# starter home + garden are created on the first /api/me
me=$(req a GET /api/me)
[ "$(echo "$me" | J "len(d['fences'])")" = "36" ]                 # 12x12 ring
[ "$(echo "$me" | J "len(d['plots'])")" = "2" ]                   # two grown trees
[ "$(echo "$me" | J "len(d['placed'])")" = "3" ]                  # bed, desk, bookcase
[ "$(echo "$me" | J "d['user']['xp']")" = "0" ]
tid=$(req a POST /api/tasks '{"name":"Read OS ch4","difficulty":2,"est_minutes":45,"start":true}' | J "d['id']")
[ "$(req a POST /api/tasks/$tid/complete '{}' | J "d['error']")" = "Finish the focus session before you complete this task" ]
req a POST /api/pomodoro/complete "{\"task_id\":$tid,\"minutes\":25}" | J "d['ok']" >/dev/null
r=$(req a POST /api/tasks/$tid/complete '{}'); echo "complete: $r"
[ "$(echo "$r" | J "d['xp']")" = "64" ]  # 20*1.75*0.9 (1 min actual vs 45 est = rushed) = 31.5 -> 32, doubled for pomodoro
[ "$(echo "$r" | J "d['streak']")" = "1" ]
me=$(req a GET /api/me); echo "$me" | J "'coins',d['user']['coins'],'xp',d['user']['xp'],'daily',d['daily']"
[ "$(echo "$me" | J "d['user']['coins']")" = "116" ]   # 100 + 16
# plots: hoe (free), taken tiles, bounds, plant, move, grassify
req a POST /api/plots/hoe '{"tx":3,"ty":3}' | J "d['ok']" >/dev/null
[ "$(req a POST /api/plots/hoe '{"tx":3,"ty":3}' | J "d['error']")" = "That tile is taken" ]
[ "$(req a POST /api/plots/hoe '{"tx":1,"ty":1}' | J "d['error']")" = "That tile is taken" ]     # fence ring
[ "$(req a POST /api/plots/hoe '{"tx":12,"ty":1}' | J "d['error']")" = "Outside your garden" ]
pid=$(req a GET /api/me | J "[p for p in d['plots'] if p['tx']==3][0]['id']")
req a POST /api/plots/$pid/plant '{"plant_id":1}' | J "'planted, ready_at',d['ready_at']"
[ "$(req a POST /api/plots/$pid/plant '{"plant_id":1}' | J "d['error']")" = "Plot already planted" ]
[ "$(req a GET /api/me | J "[p for p in d['plots'] if p['id']==$pid][0]['stage']")" = "0" ]
req a POST /api/plots/$pid/move '{"tx":4,"ty":4}' | J "d['ok']" >/dev/null
[ "$(req a POST /api/plots/$pid/move '{"tx":1,"ty":2}' | J "d['error']")" = "That tile is taken" ]
[ "$(req a GET /api/me | J "[p for p in d['plots'] if p['id']==$pid][0]['tx']")" = "4" ]
# fences: place, gate, plot conflict, remove
req a POST /api/garden/fence '{"tx":6,"ty":6,"kind":"fence"}' | J "d['ok']" >/dev/null
req a POST /api/garden/fence '{"tx":6,"ty":6,"kind":"gate"}' | J "d['ok']" >/dev/null
[ "$(req a GET /api/me | J "[f for f in d['fences'] if f['tx']==6][0]['kind']")" = "gate" ]
[ "$(req a POST /api/garden/fence '{"tx":4,"ty":4,"kind":"fence"}' | J "d['error']")" = "There is a plot here" ]
req a POST /api/garden/fence '{"tx":6,"ty":6,"kind":null}' | J "d['ok']" >/dev/null
[ "$(req a GET /api/me | J "len(d['fences'])")" = "36" ]
[ "$(req a POST /api/me/fence-color '{"color":"white"}' | J "d['color']")" = "white" ]
[ "$(req a POST /api/me/fence-color '{"color":"pink"}' | J "d['error']")" = "No such colour" ]
# shop: daily rotation, buy a stocked seed, unstocked seeds refused
shop=$(req a GET /api/shop); echo "$shop" | J "'shop plants',d['plants'],'furniture',d['furniture'],'card',d['card']"
[ "$(echo "$shop" | J "len(d['plants'])")" = "4" ]
first=$(echo "$shop" | J "d['plants'][0]")
[ "$(req a POST /api/shop/seed "{\"plant_id\":$first}" | J "d['ok']")" = "True" ]
other=$(echo "$shop" | J "[p for p in range(1,33) if p not in d['plants']][0]")
[ "$(req a POST /api/shop/seed "{\"plant_id\":$other}" | J "d['error']")" = "Not in the shop today" ]
req a POST /api/shop/spin '{}' | J "'spin',d['reels'],d['coins'],d['gems']"
[ "$(req a POST /api/shop/spin '{}' | J "d['error']")" = "Already spun today" ]
[ "$(req a POST /api/shop/card '{"card_id":9}' | J "d['error']")" = "No such card" ]
# furniture: starter pieces stay, moving works, placement needs stock + gap
bed=$(req a GET /api/me | J "[p for p in d['placed'] if p['furniture_id']==1][0]['id']")
[ "$(req a POST /api/furniture/$bed/remove '{}' | J "d['error']")" = "That piece stays in your home (you can move it)" ]
req a POST /api/furniture/$bed/move '{"cx":3,"cy":3}' | J "d['ok']" >/dev/null
[ "$(req a POST /api/furniture/place '{"furniture_id":1,"cx":8,"cy":4}' | J "d['error']")" = "None left in your inventory" ]
# friends
code=$(req b GET /api/friends | J "d['code']")
bid=$(req b GET /api/me | J "d['user']['id']")
[ "$(req a GET /api/garden/$bid | J "d['error']")" = "Not friends" ]
req a POST /api/friends/request "{\"code\":\"$code\"}" | J "d['ok']" >/dev/null
[ "$(req b GET /api/friends | J "d['friends'][0]['status']")" = "incoming" ]
aid=$(req a GET /api/me | J "d['user']['id']")
req b POST /api/friends/accept "{\"user_id\":$aid}" | J "d['ok']" >/dev/null
[ "$(req a GET /api/friends | J "d['friends'][0]['status']")" = "accepted" ]
req a GET /api/garden/$bid | J "'garden of',d['owner']['username'],len(d['plots']),'plots',len(d['fences']),'fences',d['owner']['fence_color']"
[ "$(req a GET /api/house/$bid | J "d['owner']['id']")" = "$bid" ]
req a GET /api/house/$bid | J "'home of',d['owner']['username'],len(d['placed']),'furniture'"
# settings + pomodoro + admin-only + logout
[ "$(req a POST /api/me/settings '{"frozen":1,"pomo_work":50}' | J "d['pomo_work']")" = "50" ]
[ "$(req a POST /api/me/admin-level '{"level":50}' | J "d['error']")" = "Admin accounts only" ]
req a POST /api/pomodoro/complete '{"minutes":25}' | J "d['ok']" >/dev/null
[ "$(req a GET /api/me | J "d['stats']['pomodoros']")" = "2" ]
# admin: level picked at signup, garden size follows
w=admin$RANDOM
req c POST /api/auth/signup "{\"username\":\"$w\",\"password\":\"ADMIN_TEST\",\"level\":30}" | J "d['ok']" >/dev/null
[ "$(req c GET /api/me | J "d['user']['xp']")" = "13875" ]
[ "$(req c POST /api/me/admin-level '{"level":100}' | J "d['level']")" = "100" ]
[ "$(req c POST /api/plots/hoe '{"tx":31,"ty":31}' | J "d['ok']")" = "True" ]
req a POST /api/auth/logout >/dev/null
[ "$(req a GET /api/me | J "d['error']")" = "Not signed in" ]
echo "ALL SMOKE TESTS PASSED"
