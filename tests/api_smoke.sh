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
tid=$(req a POST /api/tasks '{"name":"Read OS ch4","difficulty":2,"est_minutes":45,"start":true}' | J "d['id']")
r=$(req a POST /api/tasks/$tid/complete '{}'); echo "complete: $r"
[ "$(echo "$r" | J "d['xp']")" = "32" ]  # 20*1.75*0.9 (1 min actual vs 45 est = rushed) = 31.5 -> 32
[ "$(echo "$r" | J "d['streak']")" = "1" ]
me=$(req a GET /api/me); echo "$me" | J "'coins',d['user']['coins'],'xp',d['user']['xp'],'daily',d['daily']"
[ "$(echo "$me" | J "d['user']['coins']")" = "116" ]   # 100 + 16
# plots: 4 free, then buy
req a POST /api/plots/buy '{"tx":1,"ty":1}' | J "d['price']"
[ "$(req a POST /api/plots/buy '{"tx":1,"ty":1}' | J "d['error']")" = "Already a plot" ]
[ "$(req a POST /api/plots/buy '{"tx":9,"ty":1}' | J "d['error']")" = "Outside your garden" ]
pid=$(req a GET /api/me | J "d['plots'][0]['id']")
req a POST /api/plots/$pid/plant '{"plant_id":1}' | J "d['ok']" >/dev/null
[ "$(req a POST /api/plots/$pid/plant '{"plant_id":1}' | J "d['error']")" = "Plot already planted" ]
req a POST /api/plots/$pid/feed '{}' | J "'fed, ready_at',d['ready_at']"
[ "$(req a POST /api/plots/$pid/feed '{}' | J "d['error']")" = "Already growing" ]
# shop
req a GET /api/shop | J "'shop plants',d['plants'],'cards',len(d['cards'])"
[ "$(req a POST /api/shop/seed '{"plant_id":12}' | J "d['error']")" = "Discover this plant in a lootbox first" ]
[ "$(req a POST /api/shop/seed '{"plant_id":3}' | J "d['ok']")" = "True" ]
req a POST /api/shop/spin '{}' | J "'spin',d['reels'],d['coins'],d['gems']"
[ "$(req a POST /api/shop/spin '{}' | J "d['error']")" = "Already spun today" ]
[ "$(req a POST /api/shop/card '{"card_id":11}' | J "d['error']")" = "Need 40 gems" ]
# friends
code=$(req b GET /api/friends | J "d['code']")
bid=$(req b GET /api/me | J "d['user']['id']")
[ "$(req a GET /api/garden/$bid | J "d['error']")" = "Not friends" ]
req a POST /api/friends/request "{\"code\":\"$code\"}" | J "d['ok']" >/dev/null
[ "$(req b GET /api/friends | J "d['friends'][0]['status']")" = "incoming" ]
aid=$(req a GET /api/me | J "d['user']['id']")
req b POST /api/friends/accept "{\"user_id\":$aid}" | J "d['ok']" >/dev/null
[ "$(req a GET /api/friends | J "d['friends'][0]['status']")" = "accepted" ]
req a GET /api/garden/$bid | J "'garden of',d['owner']['username'],len(d['plots']),'plots'"
# settings + pomodoro + logout
[ "$(req a POST /api/me/settings '{"frozen":1,"pomo_work":50}' | J "d['pomo_work']")" = "50" ]
req a POST /api/pomodoro/complete "{\"task_id\":$tid,\"minutes\":25}" | J "d['ok']" >/dev/null
[ "$(req a GET /api/me | J "d['stats']['pomodoros']")" = "1" ]
req a POST /api/auth/logout >/dev/null
[ "$(req a GET /api/me | J "d['error']")" = "Not signed in" ]
echo "ALL SMOKE TESTS PASSED"
