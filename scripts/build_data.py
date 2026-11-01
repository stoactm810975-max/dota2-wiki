import concurrent.futures
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

sys.stdout.reconfigure(encoding="utf-8")

HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Dota2WikiBuilder/1.0"}


def fetch_json(url, retries=3):
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=20) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            if attempt == retries - 1:
                print(f"[WARN] Failed {url}: {e}")
                return None
            time.sleep(0.6 * (attempt + 1))
    return None


def format_num(val):
    if isinstance(val, float):
        if abs(val - round(val)) < 1e-5:
            return str(int(round(val)))
        return f"{val:.2f}".rstrip("0").rstrip(".")
    return str(val)


def format_val_list(vals, is_pct=False):
    if not vals:
        return ""
    uniq = []
    for v in vals:
        s = format_num(v)
        uniq.append(s)
    # If all values are identical, show once
    if len(set(uniq)) == 1:
        res = uniq[0]
    else:
        res = " / ".join(uniq)
    return f"{res}%" if is_pct else res


def resolve_desc_placeholders(text, special_values, extra_map=None):
    if not text:
        return ""
    sv_map = {}
    pct_map = {}
    for sv in special_values or []:
        name = sv.get("name", "")
        vals = sv.get("values_float") or []
        if not vals and sv.get("values_scepter"):
            vals = sv.get("values_scepter")
        if not vals and sv.get("values_shard"):
            vals = sv.get("values_shard")
        if vals:
            sv_map[name.lower()] = format_val_list(vals, False)
            pct_map[name.lower()] = sv.get("is_percentage", False)
        if sv.get("values_scepter"):
            sv_map[f"scepter_{name}".lower()] = format_val_list(sv["values_scepter"], False)
            if name.lower() not in sv_map or sv_map[name.lower()] == "0":
                sv_map[name.lower()] = format_val_list(sv["values_scepter"], False)
        if sv.get("values_shard"):
            sv_map[f"shard_{name}".lower()] = format_val_list(sv["values_shard"], False)
            if name.lower() not in sv_map or sv_map[name.lower()] == "0":
                sv_map[name.lower()] = format_val_list(sv["values_shard"], False)
    if extra_map:
        for k, v in extra_map.items():
            sv_map[k.lower()] = str(v)

    # Replace %% with literal %
    # First replace %var%%% -> value%
    def repl_pct(m):
        key = m.group(1).lower()
        if key in sv_map:
            return f"<span class=\"val-hl\">{sv_map[key]}%</span>"
        return m.group(0)

    text = re.sub(r"%([a-zA-Z0-9_]+)%%%", repl_pct, text)

    def repl_var(m):
        key = m.group(1).lower()
        if key in sv_map:
            is_p = pct_map.get(key, False)
            suffix = "%" if is_p else ""
            return f"<span class=\"val-hl\">{sv_map[key]}{suffix}</span>"
        return ""

    text = re.sub(r"%([a-zA-Z0-9_]+)%", repl_var, text)
    text = text.replace("%%", "%")

    # Also resolve {s:bonus_...} or {s:value}
    def repl_brace(m):
        key = m.group(1).lower()
        if key in sv_map:
            return f"<span class=\"val-hl\">{sv_map[key]}</span>"
        if key.startswith("bonus_") and key[6:] in sv_map:
            return f"<span class=\"val-hl\">{sv_map[key[6:]]}</span>"
        return m.group(0)

    text = re.sub(r"\{s:([a-zA-Z0-9_]+)\}", repl_brace, text)
    return text


def main():
    print("1. Fetching hero list and item list from dota2.com (7.41f)...")
    hero_list_resp = fetch_json("https://www.dota2.com/datafeed/herolist?language=schinese")
    hero_list = hero_list_resp["result"]["data"]["heroes"]
    print(f"   Found {len(hero_list)} heroes.")

    item_list_resp = fetch_json("https://www.dota2.com/datafeed/itemlist?language=schinese")
    item_list = item_list_resp["result"]["data"]["itemabilities"]
    print(f"   Found {len(item_list)} item entries.")

    print("2. Fetching OpenDota heroStats, constants/items, and Explorer SQL analytics...")
    od_hero_stats = fetch_json("https://api.opendota.com/api/heroStats") or []
    od_hero_map = {h["id"]: h for h in od_hero_stats}

    od_const_items = fetch_json("https://api.opendota.com/api/constants/items") or {}

    def run_explorer_sql(sql):
        q = urllib.parse.quote(sql)
        res = fetch_json(f"https://api.opendota.com/api/explorer?sql={q}")
        return res.get("rows", []) if res else []

    print("   Querying OpenDota Explorer for lane roles...")
    lane_rows = run_explorer_sql("""
        SELECT hero_id, lane_role, count(*) as games,
               sum(case when ((player_slot < 128) = radiant_win) then 1 else 0 end) as wins
        FROM player_matches
        JOIN matches USING(match_id)
        WHERE matches.start_time > 1770000000 AND lane_role IS NOT NULL
        GROUP BY hero_id, lane_role
        ORDER BY hero_id, games DESC
    """)

    print("   Querying OpenDota Explorer for hero average KDA/GPM/XPM...")
    avg_rows = run_explorer_sql("""
        SELECT hero_id,
               count(*) as matches,
               round(avg(kills)::numeric, 1) as avg_k,
               round(avg(deaths)::numeric, 1) as avg_d,
               round(avg(assists)::numeric, 1) as avg_a,
               round(avg(gold_per_min)::numeric, 0) as avg_gpm,
               round(avg(xp_per_min)::numeric, 0) as avg_xpm,
               round(avg(hero_damage)::numeric, 0) as avg_hd,
               round(avg(tower_damage)::numeric, 0) as avg_td
        FROM player_matches
        JOIN matches USING(match_id)
        WHERE matches.start_time > 1770000000
        GROUP BY hero_id
        ORDER BY hero_id
    """)

    print("   Querying OpenDota Explorer for final core item builds & winrates...")
    core_item_rows = run_explorer_sql("""
        SELECT hero_id, item_id, count(*) as picks, sum(win) as wins
        FROM (
          SELECT hero_id, unnest(ARRAY[item_0, item_1, item_2, item_3, item_4, item_5]) as item_id,
                 CASE WHEN ((player_slot < 128) = radiant_win) THEN 1 ELSE 0 END as win
          FROM player_matches
          JOIN matches USING(match_id)
          WHERE matches.start_time > 1770000000
        ) t
        WHERE item_id > 0
        GROUP BY hero_id, item_id
        HAVING count(*) >= 3
        ORDER BY hero_id, picks DESC
    """)

    print("   Querying OpenDota Explorer for neutral item builds & winrates...")
    neutral_item_rows = run_explorer_sql("""
        SELECT hero_id, item_neutral as item_id, count(*) as picks,
               sum(CASE WHEN ((player_slot < 128) = radiant_win) THEN 1 ELSE 0 END) as wins
        FROM player_matches
        JOIN matches USING(match_id)
        WHERE matches.start_time > 1770000000 AND item_neutral > 0
        GROUP BY hero_id, item_neutral
        HAVING count(*) >= 2
        ORDER BY hero_id, picks DESC
    """)

    print("   Querying OpenDota Explorer for starting/early/mid/late purchase phases...")
    phase_item_rows = run_explorer_sql("""
        SELECT hero_id, elem->>'key' as item_key,
               CASE
                 WHEN (elem->>'time')::int <= 0 THEN 'start'
                 WHEN (elem->>'time')::int <= 600 THEN 'early'
                 WHEN (elem->>'time')::int <= 1500 THEN 'mid'
                 ELSE 'late'
               END as phase,
               count(*) as cnt
        FROM (
          SELECT hero_id, purchase_log
          FROM player_matches
          JOIN matches USING(match_id)
          WHERE matches.start_time > 1780000000 AND purchase_log IS NOT NULL
          LIMIT 8000
        ) pm,
        jsonb_array_elements(to_jsonb(pm.purchase_log)) as elem
        GROUP BY hero_id, item_key, phase
        HAVING count(*) >= 3
        ORDER BY hero_id, cnt DESC
    """)

    print("   Querying OpenDota Explorer for popular skill builds...")
    skill_build_rows = run_explorer_sql("""
        SELECT DISTINCT ON (hero_id) hero_id, ability_upgrades_arr[1:18] as skill_build, count(*) as cnt
        FROM player_matches
        JOIN matches USING(match_id)
        WHERE matches.start_time > 1770000000 AND array_length(ability_upgrades_arr, 1) >= 15
        GROUP BY hero_id, ability_upgrades_arr[1:18]
        ORDER BY hero_id, cnt DESC
    """)

    print("3. Fetching 7.41 ~ 7.41f patch notes from dota2.com...")
    patch_versions = ["7.41f", "7.41e", "7.41d", "7.41c", "7.41b", "7.41a", "7.41"]
    patches_raw = {}
    for pv in patch_versions:
        p_data = fetch_json(f"https://www.dota2.com/datafeed/patchnotes?version={pv}&language=schinese")
        if p_data and p_data.get("success"):
            patches_raw[pv] = p_data
            print(f"   Loaded patch {pv} (heroes={len(p_data.get('heroes', []))}, items={len(p_data.get('items', []))})")

    print("4. Fetching all 127 heroes detailed data from dota2.com in parallel...")
    heroes_raw = {}

    def fetch_hero_detail(h_meta):
        hid = h_meta["id"]
        d = fetch_json(f"https://www.dota2.com/datafeed/herodata?language=schinese&hero_id={hid}")
        if d and d.get("result", {}).get("data", {}).get("heroes"):
            return hid, d["result"]["data"]["heroes"][0]
        return hid, None

    with concurrent.futures.ThreadPoolExecutor(max_workers=16) as ex:
        futures = [ex.submit(fetch_hero_detail, h) for h in hero_list]
        for f in concurrent.futures.as_completed(futures):
            hid, hdata = f.result()
            if hdata:
                heroes_raw[hid] = hdata
    print(f"   Successfully fetched {len(heroes_raw)} / {len(hero_list)} hero details.")

    # Filter item_list to non-recipe items for detail fetching, while keeping recipe mappings
    recipe_map = {}  # target_item_name -> list of component item IDs
    item_meta_by_id = {it["id"]: it for it in item_list}
    item_meta_by_name = {it["name"]: it for it in item_list}

    for it in item_list:
        name = it["name"]
        if name.startswith("item_recipe_") and it.get("recipes"):
            target_name = "item_" + name[len("item_recipe_"):]
            comp_ids = it["recipes"][0].get("items", [])
            if comp_ids:
                recipe_map[target_name] = {
                    "recipe_id": it["id"],
                    "components": comp_ids,
                }
        elif it.get("recipes"):
            comp_ids = it["recipes"][0].get("items", [])
            if comp_ids:
                recipe_map[name] = {
                    "recipe_id": None,
                    "components": comp_ids,
                }

    non_recipe_items = [it for it in item_list if not it["name"].startswith("item_recipe_")]
    print(f"5. Fetching {len(non_recipe_items)} non-recipe items from dota2.com in parallel...")
    items_raw = {}

    def fetch_item_detail(it_meta):
        iid = it_meta["id"]
        d = fetch_json(f"https://www.dota2.com/datafeed/itemdata?language=schinese&item_id={iid}")
        if d and d.get("result", {}).get("data", {}).get("items"):
            return iid, d["result"]["data"]["items"][0]
        return iid, None

    with concurrent.futures.ThreadPoolExecutor(max_workers=20) as ex:
        futures = [ex.submit(fetch_item_detail, it) for it in non_recipe_items]
        for f in concurrent.futures.as_completed(futures):
            iid, idata = f.result()
            if idata:
                items_raw[iid] = idata
    print(f"   Successfully fetched {len(items_raw)} / {len(non_recipe_items)} item details.")

    # Index patch notes by hero_id and item_id (ability_id)
    hero_patch_history = {}  # hero_id -> list of {version, notes, ability_notes}
    item_patch_history = {}  # item_id -> list of {version, notes}
    ability_info_by_id = {}  # ability_id -> {name, name_loc, icon}

    for hid, hdata in heroes_raw.items():
        for ab in hdata.get("abilities", []):
            ab_name = ab.get("name", "")
            ability_info_by_id[ab["id"]] = {
                "id": ab["id"],
                "name": ab_name,
                "name_loc": ab.get("name_loc", ab_name),
                "icon": f"https://cdn.steamstatic.com/apps/dota2/images/dota_react/abilities/{ab_name}.png",
            }
        for tal in hdata.get("talents", []):
            ability_info_by_id[tal["id"]] = {
                "id": tal["id"],
                "name": tal.get("name", ""),
                "name_loc": tal.get("name_loc", "天赋"),
                "icon": "",
            }

    for pv in patch_versions:
        pdata = patches_raw.get(pv)
        if not pdata:
            continue
        for h_entry in pdata.get("heroes", []):
            hid = h_entry["hero_id"]
            h_notes = [n["note"] for n in h_entry.get("hero_notes", []) if n.get("note") and n["note"] != "<br>"]
            t_notes = [n["note"] for n in h_entry.get("talent_notes", []) if n.get("note") and n["note"] != "<br>"]
            ab_entries = []
            for ab_e in h_entry.get("abilities", []):
                ab_id = ab_e["ability_id"]
                ab_info = ability_info_by_id.get(ab_id, {"id": ab_id, "name": "", "name_loc": "技能调整", "icon": ""})
                notes = [n["note"] for n in ab_e.get("ability_notes", []) if n.get("note") and n["note"] != "<br>"]
                if notes:
                    ab_entries.append({
                        "ability_id": ab_id,
                        "name": ab_info["name"],
                        "name_loc": ab_info["name_loc"],
                        "icon": ab_info["icon"],
                        "notes": notes,
                    })
            if h_notes or t_notes or ab_entries:
                hero_patch_history.setdefault(hid, []).append({
                    "version": pv,
                    "hero_notes": h_notes,
                    "talent_notes": t_notes,
                    "abilities": ab_entries,
                })

        for section_key in ("items", "neutral_items"):
            for it_entry in pdata.get(section_key, []):
                iid = it_entry["ability_id"]
                notes = [n["note"] for n in it_entry.get("ability_notes", []) if n.get("note") and n["note"] != "<br>"]
                if notes:
                    item_patch_history.setdefault(iid, []).append({
                        "version": pv,
                        "notes": notes,
                    })

    # Build clean items dictionary & list
    # Also compute top heroes for each item from core_item_rows + neutral_item_rows
    item_top_heroes = {}
    for row in core_item_rows + neutral_item_rows:
        iid = int(row["item_id"])
        hid = int(row["hero_id"])
        picks = int(row["picks"])
        wins = int(row["wins"])
        if picks >= 5:
            item_top_heroes.setdefault(iid, []).append({
                "hero_id": hid,
                "picks": picks,
                "wins": wins,
                "winrate": round(wins * 100.0 / picks, 1),
            })
    for iid in item_top_heroes:
        item_top_heroes[iid].sort(key=lambda x: x["picks"], reverse=True)
        item_top_heroes[iid] = item_top_heroes[iid][:8]

    # Build item reverse recipe map (builds_into)
    builds_into_map = {}  # comp_id -> list of target_item_id
    for target_name, rinfo in recipe_map.items():
        target_meta = item_meta_by_name.get(target_name)
        if not target_meta:
            continue
        target_id = target_meta["id"]
        for cid in rinfo["components"]:
            if target_id not in builds_into_map.setdefault(cid, []):
                builds_into_map[cid].append(target_id)

    CATEGORY_LABELS = {
        "consumable": "消耗品",
        "consumable;laning": "消耗品",
        "attribute": "属性",
        "component": "基础配件",
        "common": "常用合成",
        "rare": "辅助与法器",
        "epic": "神装与武器",
        "artifact": "圣物与秘法",
        "secret_shop": "神秘商店",
    }

    compiled_items = []
    items_by_id = {}
    items_by_short_name = {}

    for iid, idata in items_raw.items():
        meta = item_meta_by_id.get(iid, {})
        name = idata.get("name", meta.get("name", ""))
        short_name = name[5:] if name.startswith("item_") else name
        name_loc = (idata.get("name_loc") or meta.get("name_loc") or "").strip()
        name_en = (meta.get("name_english_loc") or "").strip()
        if not name_loc:
            continue
        # Skip deprecated/internal items that have no icon and no cost and are not neutral
        od_it = od_const_items.get(short_name) or {}
        cost = idata.get("item_cost", 0) or od_it.get("cost", 0) or 0
        neutral_tier_raw = meta.get("neutral_item_tier", -1)
        neutral_tier = (neutral_tier_raw + 1) if (neutral_tier_raw is not None and neutral_tier_raw >= 0) else (od_it.get("tier") or None)

        # Skip internal ability placeholders or unreleased tokens with 0 cost and not neutral and not consumable like aegis/cheese/roshan drops
        special_drops = {"aegis", "cheese", "refresher_shard", "aghanims_shard_roshan", "ultimate_scepter_roshan", "famango", "great_famango", "greater_famango"}
        if cost == 0 and not neutral_tier and short_name not in special_drops and not od_it.get("qual"):
            continue
        if "river_painter" in short_name or "mutation" in short_name or "pocket_roshan" in short_name:
            continue

        qual_raw = od_it.get("qual") or ""
        if neutral_tier:
            category = f"neutral_{neutral_tier}"
            category_loc = f"{neutral_tier}级中立物品"
        elif short_name in special_drops:
            category = "roshan_special"
            category_loc = "肉山/特殊掉落"
        elif qual_raw in CATEGORY_LABELS:
            category = qual_raw.split(";")[0]
            category_loc = CATEGORY_LABELS[qual_raw]
        elif cost <= 600 and not recipe_map.get(name):
            category = "component"
            category_loc = "基础配件"
        elif cost >= 4000:
            category = "epic"
            category_loc = "神装与武器"
        else:
            category = "common"
            category_loc = "常用合成"

        sv_list = []
        for sv in idata.get("special_values", []):
            heading = (sv.get("heading_loc") or "").strip()
            vals = sv.get("values_float") or []
            if heading and vals:
                sv_list.append({
                    "name": sv.get("name", ""),
                    "heading": heading,
                    "value": format_val_list(vals, sv.get("is_percentage", False)),
                })

        desc_html = resolve_desc_placeholders(idata.get("desc_loc", ""), idata.get("special_values", []))
        notes_list = [
            resolve_desc_placeholders(n, idata.get("special_values", []))
            for n in idata.get("notes_loc", [])
            if n and n.strip()
        ]

        # Components
        comp_ids = []
        if name in recipe_map:
            comp_ids = [cid for cid in recipe_map[name]["components"] if cid in items_raw]
        elif od_it.get("components"):
            for cname in od_it["components"]:
                cmeta = item_meta_by_name.get(f"item_{cname}")
                if cmeta and cmeta["id"] in items_raw:
                    comp_ids.append(cmeta["id"])

        cooldowns = [c for c in idata.get("cooldowns", []) if c and c > 0]
        mana_costs = [m for m in idata.get("mana_costs", []) if m and m > 0]
        cast_ranges = [r for r in idata.get("cast_ranges", []) if r and r > 0]

        item_obj = {
            "id": iid,
            "name": name,
            "short_name": short_name,
            "name_loc": name_loc,
            "name_en": name_en or od_it.get("dname", short_name),
            "icon": f"https://cdn.steamstatic.com/apps/dota2/images/dota_react/items/{short_name}.png",
            "cost": cost,
            "category": category,
            "category_loc": category_loc,
            "neutral_tier": neutral_tier,
            "is_pregame": bool(meta.get("is_pregame_suggested")),
            "is_earlygame": bool(meta.get("is_earlygame_suggested")),
            "is_lategame": bool(meta.get("is_lategame_suggested")),
            "cooldown": format_val_list(cooldowns) if cooldowns else "",
            "mana_cost": format_val_list(mana_costs) if mana_costs else "",
            "cast_range": format_val_list(cast_ranges) if cast_ranges else "",
            "desc_html": desc_html,
            "lore": (idata.get("lore_loc") or "").strip(),
            "notes": notes_list,
            "attributes": sv_list,
            "components": comp_ids,
            "builds_into": [bid for bid in builds_into_map.get(iid, []) if bid in items_raw],
            "top_heroes": item_top_heroes.get(iid, []),
            "patch_notes": item_patch_history.get(iid, []),
        }
        compiled_items.append(item_obj)
        items_by_id[iid] = item_obj
        items_by_short_name[short_name] = item_obj

    # Compute recipe_cost for items with components
    for it in compiled_items:
        if it["components"] and it["cost"] > 0:
            comp_sum = sum(items_by_id[cid]["cost"] for cid in it["components"] if cid in items_by_id)
            diff = it["cost"] - comp_sum
            it["recipe_cost"] = diff if diff > 0 else 0
        else:
            it["recipe_cost"] = 0

    compiled_items.sort(key=lambda x: (1 if x["neutral_tier"] else 0, x["neutral_tier"] or 0, x["cost"], x["id"]))
    print(f"   Compiled {len(compiled_items)} clean active items.")

    # Index OpenDota analytics by hero_id
    lanes_by_hero = {}
    for r in lane_rows:
        lanes_by_hero.setdefault(int(r["hero_id"]), []).append({
            "lane_role": int(r["lane_role"]),
            "games": int(r["games"]),
            "wins": int(r["wins"]),
        })

    avg_by_hero = {int(r["hero_id"]): r for r in avg_rows}

    core_items_by_hero = {}
    for r in core_item_rows:
        hid = int(r["hero_id"])
        iid = int(r["item_id"])
        if iid in items_by_id:
            core_items_by_hero.setdefault(hid, []).append({
                "item_id": iid,
                "picks": int(r["picks"]),
                "wins": int(r["wins"]),
            })

    neutral_items_by_hero = {}
    for r in neutral_item_rows:
        hid = int(r["hero_id"])
        iid = int(r["item_id"])
        if iid in items_by_id:
            neutral_items_by_hero.setdefault(hid, []).append({
                "item_id": iid,
                "picks": int(r["picks"]),
                "wins": int(r["wins"]),
            })

    phase_items_by_hero = {}
    for r in phase_item_rows:
        hid = int(r["hero_id"])
        ikey = r["item_key"]
        phase = r["phase"]
        cnt = int(r["cnt"])
        if ikey in items_by_short_name:
            iid = items_by_short_name[ikey]["id"]
            phase_items_by_hero.setdefault(hid, {}).setdefault(phase, []).append({
                "item_id": iid,
                "cnt": cnt,
            })

    skill_build_by_hero = {int(r["hero_id"]): r["skill_build"] for r in skill_build_rows}

    ATTR_NAMES = {0: "str", 1: "agi", 2: "int", 3: "all"}
    ATTR_LABELS = {0: "力量", 1: "敏捷", 2: "智力", 3: "全才"}
    ROLE_NAMES_CN = ["核心", "辅助", "爆发", "控制", "打野", "耐久", "逃生", "推进", "先手"]
    DAMAGE_LABELS = {1: "物理", 2: "魔法", 4: "纯粹"}
    IMMUNITY_LABELS = {1: "是", 2: "是", 3: "否", 4: "否", 5: "是"}
    DISPELLABLE_LABELS = {1: "仅强驱散", 2: "可驱散", 3: "不可驱散"}

    compiled_heroes = []
    for h_meta in hero_list:
        hid = h_meta["id"]
        hdata = heroes_raw.get(hid)
        if not hdata:
            continue
        name = hdata["name"]
        short_name = name[len("npc_dota_hero_"):] if name.startswith("npc_dota_hero_") else name
        od_h = od_hero_map.get(hid, {})

        # Collect all bonus values from abilities so talents can resolve {s:bonus_*}
        talent_bonus_map = {}
        for ab in hdata.get("abilities", []):
            for sv in ab.get("special_values", []):
                sv_name = sv.get("name", "")
                is_pct = sv.get("is_percentage", False)
                for b in sv.get("bonuses", []):
                    b_name = b.get("name", "")
                    b_val = b.get("value", 0)
                    if b_name:
                        val_str = format_num(b_val) + ("%" if is_pct else "")
                        talent_bonus_map.setdefault(b_name, {})[f"bonus_{sv_name}"] = val_str
                        talent_bonus_map[b_name][sv_name] = val_str
                        talent_bonus_map[b_name]["value"] = val_str

        # Build abilities list
        abilities_out = []
        hero_ability_ids = set()
        for ab in hdata.get("abilities", []):
            ab_name = ab.get("name", "")
            ab_loc = (ab.get("name_loc") or "").strip()
            if not ab_loc or ab_name.startswith("generic_hidden"):
                continue
            hero_ability_ids.add(ab["id"])

            sv_out = []
            for sv in ab.get("special_values", []):
                heading = (sv.get("heading_loc") or "").strip()
                vals = sv.get("values_float") or []
                scepter_vals = sv.get("values_scepter") or []
                shard_vals = sv.get("values_shard") or []
                is_pct = sv.get("is_percentage", False)
                if heading and (vals or scepter_vals or shard_vals):
                    val_str = format_val_list(vals, is_pct) if vals and vals != [0] else ""
                    scepter_str = format_val_list(scepter_vals, is_pct) if scepter_vals else ""
                    shard_str = format_val_list(shard_vals, is_pct) if shard_vals else ""
                    if val_str or scepter_str or shard_str:
                        sv_out.append({
                            "name": sv.get("name", ""),
                            "heading": heading,
                            "value": val_str,
                            "scepter_value": scepter_str,
                            "shard_value": shard_str,
                        })

            extra_vars = {}
            if ab.get("durations") and any(d > 0 for d in ab["durations"]):
                extra_vars["abilityduration"] = format_val_list([d for d in ab["durations"] if d > 0])
            if ab.get("cast_ranges") and any(r > 0 for r in ab["cast_ranges"]):
                extra_vars["abilitycastrange"] = format_val_list([r for r in ab["cast_ranges"] if r > 0])
            if ab.get("cooldowns") and any(c > 0 for c in ab["cooldowns"]):
                extra_vars["abilitycooldown"] = format_val_list([c for c in ab["cooldowns"] if c > 0])
            if ab.get("damages") and any(dmg > 0 for dmg in ab["damages"]):
                extra_vars["abilitydamage"] = format_val_list([dmg for dmg in ab["damages"] if dmg > 0])

            desc_html = resolve_desc_placeholders(ab.get("desc_loc", ""), ab.get("special_values", []), extra_vars)
            scepter_html = resolve_desc_placeholders(ab.get("scepter_loc", ""), ab.get("special_values", []), extra_vars)
            shard_html = resolve_desc_placeholders(ab.get("shard_loc", ""), ab.get("special_values", []), extra_vars)
            notes_out = [
                resolve_desc_placeholders(n, ab.get("special_values", []), extra_vars)
                for n in ab.get("notes_loc", [])
                if n and n.strip()
            ]

            cooldowns = [c for c in ab.get("cooldowns", []) if c is not None and c > 0]
            mana_costs = [m for m in ab.get("mana_costs", []) if m is not None and m > 0]
            cast_ranges = [r for r in ab.get("cast_ranges", []) if r is not None and r > 0]

            abilities_out.append({
                "id": ab["id"],
                "name": ab_name,
                "name_loc": ab_loc,
                "icon": f"https://cdn.steamstatic.com/apps/dota2/images/dota_react/abilities/{ab_name}.png",
                "desc_html": desc_html,
                "lore": (ab.get("lore_loc") or "").strip(),
                "notes": notes_out,
                "is_innate": bool(ab.get("ability_is_innate")),
                "is_ultimate": ab.get("type") == 1,
                "has_scepter": bool(ab.get("ability_has_scepter")),
                "has_shard": bool(ab.get("ability_has_shard")),
                "granted_by_scepter": bool(ab.get("ability_is_granted_by_scepter")),
                "granted_by_shard": bool(ab.get("ability_is_granted_by_shard")),
                "scepter_html": scepter_html,
                "shard_html": shard_html,
                "damage_type": DAMAGE_LABELS.get(ab.get("damage"), ""),
                "pierces_bkb": IMMUNITY_LABELS.get(ab.get("immunity"), ""),
                "dispellable": DISPELLABLE_LABELS.get(ab.get("dispellable"), ""),
                "cooldown": format_val_list(cooldowns) if cooldowns else "",
                "mana_cost": format_val_list(mana_costs) if mana_costs else "",
                "cast_range": format_val_list(cast_ranges) if cast_ranges else "",
                "special_values": sv_out,
            })

        # Build Talents (8 talents: index 0,1 = lvl 10; 2,3 = lvl 15; 4,5 = lvl 20; 6,7 = lvl 25)
        raw_talents = hdata.get("talents", [])
        talents_out = []
        levels = [10, 15, 20, 25]
        for idx, lvl in enumerate(levels):
            pair = raw_talents[idx * 2 : idx * 2 + 2]
            resolved_pair = []
            for t in pair:
                t_name = t.get("name", "")
                t_loc = t.get("name_loc", "")
                b_map = talent_bonus_map.get(t_name, {})
                resolved_text = resolve_desc_placeholders(t_loc, t.get("special_values", []), b_map)
                # Strip HTML spans for clean talent text
                clean_text = re.sub(r"<[^>]+>", "", resolved_text)
                resolved_pair.append({
                    "id": t["id"],
                    "name": t_name,
                    "text": clean_text,
                })
            if len(resolved_pair) == 2:
                talents_out.append({
                    "level": lvl,
                    "right": resolved_pair[0]["text"],
                    "left": resolved_pair[1]["text"],
                })

        # Winrate & Pick trends by bracket
        brackets = [
            {"id": 1, "name": "先锋", "name_en": "Herald"},
            {"id": 2, "name": "卫士", "name_en": "Guardian"},
            {"id": 3, "name": "中军", "name_en": "Crusader"},
            {"id": 4, "name": "统帅", "name_en": "Archon"},
            {"id": 5, "name": "传奇", "name_en": "Legend"},
            {"id": 6, "name": "万古流芳", "name_en": "Ancient"},
            {"id": 7, "name": "超凡/冠绝", "name_en": "Divine+Immortal"},
        ]
        bracket_stats = []
        total_b_picks = 0
        total_b_wins = 0
        for b in brackets:
            bid = b["id"]
            p = int(od_h.get(f"{bid}_pick") or 0)
            w = int(od_h.get(f"{bid}_win") or 0)
            if bid == 7:
                p += int(od_h.get("8_pick") or 0)
                w += int(od_h.get("8_win") or 0)
            total_b_picks += p
            total_b_wins += w
            wr = round(w * 100.0 / p, 2) if p > 0 else 50.0
            bracket_stats.append({
                "name": b["name"],
                "picks": p,
                "wins": w,
                "winrate": wr,
            })

        pub_pick = int(od_h.get("pub_pick") or total_b_picks or 1)
        pub_win = int(od_h.get("pub_win") or total_b_wins or 0)
        overall_wr = round(pub_win * 100.0 / pub_pick, 2) if pub_pick > 0 else 50.0

        turbo_picks = int(od_h.get("turbo_picks") or 0)
        turbo_wins = int(od_h.get("turbo_wins") or 0)
        turbo_wr = round(turbo_wins * 100.0 / turbo_picks, 2) if turbo_picks > 0 else 50.0

        # 7-day daily winrate trend
        p_trend = od_h.get("pub_pick_trend") or []
        w_trend = od_h.get("pub_win_trend") or []
        daily_trend = []
        for idx_d in range(min(len(p_trend), len(w_trend))):
            dp = p_trend[idx_d]
            dw = w_trend[idx_d]
            if dp > 0:
                daily_trend.append({
                    "day": f"D-{min(len(p_trend), len(w_trend)) - idx_d}",
                    "picks": dp,
                    "wins": dw,
                    "winrate": round(dw * 100.0 / dp, 2),
                })

        # Positions (1~5号位) distribution
        role_levels = hdata.get("role_levels", [0] * 9)
        carry_lvl = role_levels[0] if len(role_levels) > 0 else 0
        supp_lvl = role_levels[1] if len(role_levels) > 1 else 0
        raw_lanes = lanes_by_hero.get(hid, [])
        lane_map = {r["lane_role"]: r for r in raw_lanes}
        s1 = lane_map.get(1, {"games": 0, "wins": 0})
        s2 = lane_map.get(2, {"games": 0, "wins": 0})
        s3 = lane_map.get(3, {"games": 0, "wins": 0})
        s4 = lane_map.get(4, {"games": 0, "wins": 0})

        # Split Safe Lane (lane_role=1) and Offlane (lane_role=3) between Core (Pos 1/3) and Support (Pos 5/4) based on Carry vs Support role & GPM
        avg_info = avg_by_hero.get(hid, {})
        avg_gpm = float(avg_info.get("avg_gpm") or 450)
        if carry_lvl >= 2 and supp_lvl == 0:
            pos1_ratio, pos3_ratio = 0.92, 0.88
        elif supp_lvl >= 2 and carry_lvl == 0:
            pos1_ratio, pos3_ratio = 0.06, 0.12
        elif avg_gpm >= 520:
            pos1_ratio, pos3_ratio = 0.82, 0.78
        elif avg_gpm <= 380:
            pos1_ratio, pos3_ratio = 0.10, 0.18
        else:
            pos1_ratio, pos3_ratio = 0.50, 0.55

        pos_games = {
            1: int(round(s1["games"] * pos1_ratio)),
            5: int(round(s1["games"] * (1 - pos1_ratio))),
            2: s2["games"],
            3: int(round(s3["games"] * pos3_ratio)),
            4: int(round(s3["games"] * (1 - pos3_ratio))) + s4["games"],
        }
        pos_wins = {
            1: int(round(s1["wins"] * pos1_ratio)),
            5: int(round(s1["wins"] * (1 - pos1_ratio))),
            2: s2["wins"],
            3: int(round(s3["wins"] * pos3_ratio)),
            4: int(round(s3["wins"] * (1 - pos3_ratio))) + s4["wins"],
        }
        total_pos_games = sum(pos_games.values()) or 1
        POS_META = [
            (1, "1号位 · 优势路核心", "Safe Lane Carry"),
            (2, "2号位 · 中单核心", "Mid Lane"),
            (3, "3号位 · 劣势路核心", "Offlane"),
            (4, "4号位 · 游走/半辅助", "Soft Support"),
            (5, "5号位 · 纯辅助", "Hard Support"),
        ]
        positions_out = []
        for pos_num, pos_label, pos_en in POS_META:
            g = pos_games[pos_num]
            w = pos_wins[pos_num]
            share = round(g * 100.0 / total_pos_games, 1)
            wr = round(w * 100.0 / g, 1) if g >= 5 else overall_wr
            positions_out.append({
                "pos": pos_num,
                "label": pos_label,
                "label_en": pos_en,
                "pick_share": share,
                "games": g,
                "winrate": wr,
            })
        positions_out.sort(key=lambda x: x["pick_share"], reverse=True)

        # Item Builds (Starting, Early, Core, Luxury, Neutral)
        hero_phases = phase_items_by_hero.get(hid, {})
        hero_cores = core_items_by_hero.get(hid, [])
        hero_neutrals = neutral_items_by_hero.get(hid, [])

        # Starting items
        start_ids = [x["item_id"] for x in hero_phases.get("start", []) if items_by_id[x["item_id"]]["cost"] <= 600][:6]
        if len(start_ids) < 4:
            # Fallback to standard starting items based on primary attr
            default_starts = [44, 16, 16, 34, 237, 11 if hdata["attack_capability"] == 1 else 20]
            for did in default_starts:
                if did in items_by_id and did not in start_ids:
                    start_ids.append(did)
                if len(start_ids) >= 6:
                    break

        # Early items (cost 400..2300)
        early_ids = []
        for x in hero_phases.get("early", []) + hero_cores:
            iid = x["item_id"]
            it_obj = items_by_id.get(iid)
            if it_obj and 350 <= it_obj["cost"] <= 2300 and not it_obj["neutral_tier"] and iid not in early_ids:
                early_ids.append(iid)
            if len(early_ids) >= 6:
                break

        # Core items (top picked final items with cost >= 1300)
        core_out = []
        total_hero_matches = int(avg_info.get("matches") or 100)
        for x in hero_cores:
            iid = x["item_id"]
            it_obj = items_by_id.get(iid)
            if it_obj and it_obj["cost"] >= 1300 and not it_obj["neutral_tier"]:
                picks = x["picks"]
                wins = x["wins"]
                core_out.append({
                    "item_id": iid,
                    "picks": picks,
                    "pick_rate": min(99.0, round(picks * 100.0 / max(total_hero_matches, picks), 1)),
                    "winrate": round(wins * 100.0 / picks, 1),
                })
            if len(core_out) >= 8:
                break

        # Luxury / Situational Late Game items (cost >= 3800, sorted by winrate/picks)
        core_id_set = {c["item_id"] for c in core_out[:5]}
        luxury_out = []
        for x in hero_cores:
            iid = x["item_id"]
            it_obj = items_by_id.get(iid)
            if it_obj and it_obj["cost"] >= 3500 and not it_obj["neutral_tier"] and iid not in core_id_set and x["picks"] >= 5:
                picks = x["picks"]
                wins = x["wins"]
                luxury_out.append({
                    "item_id": iid,
                    "picks": picks,
                    "winrate": round(wins * 100.0 / picks, 1),
                })
            if len(luxury_out) >= 6:
                break

        # Neutral items
        neutral_out = []
        for x in hero_neutrals[:6]:
            iid = x["item_id"]
            picks = x["picks"]
            wins = x["wins"]
            neutral_out.append({
                "item_id": iid,
                "picks": picks,
                "winrate": round(wins * 100.0 / picks, 1),
            })

        # Skill build (filter to this hero's basic + ultimate abilities)
        raw_sb = skill_build_by_hero.get(hid, [])
        clean_sb = [ab_id for ab_id in raw_sb if ab_id in hero_ability_ids][:15]

        # Compute base damage at lvl 1 carefully
        p_attr = hdata["primary_attr"]
        hero_obj = {
            "id": hid,
            "name": name,
            "short_name": short_name,
            "name_loc": hdata["name_loc"],
            "name_en": od_h.get("localized_name") or h_meta.get("name_english_loc") or short_name.replace("_", " ").title(),
            "primary_attr": p_attr,
            "primary_attr_key": ATTR_NAMES.get(p_attr, "all"),
            "primary_attr_loc": ATTR_LABELS.get(p_attr, "全才"),
            "complexity": hdata.get("complexity", 1),
            "attack_capability": hdata.get("attack_capability", 1),
            "attack_type_loc": "近战" if hdata.get("attack_capability", 1) == 1 else "远程",
            "roles": [
                {"name": ROLE_NAMES_CN[i], "level": lvl}
                for i, lvl in enumerate(role_levels)
                if lvl > 0
            ],
            "role_levels": role_levels,
            "avatar": f"https://cdn.steamstatic.com/apps/dota2/images/dota_react/heroes/{short_name}.png",
            "icon": f"https://cdn.steamstatic.com/apps/dota2/images/dota_react/heroes/icons/{short_name}.png",
            "crop": f"https://cdn.steamstatic.com/apps/dota2/images/dota_react/heroes/crops/{short_name}.png",
            "portrait_png": f"https://cdn.steamstatic.com/apps/dota2/videos/dota_react/heroes/renders/{short_name}.png",
            "portrait_webm": f"https://cdn.steamstatic.com/apps/dota2/videos/dota_react/heroes/renders/{short_name}.webm",
            "hype": (hdata.get("hype_loc") or "").strip(),
            "npe_desc": (hdata.get("npe_desc_loc") or "").strip(),
            "bio": (hdata.get("bio_loc") or "").strip(),
            "stats": {
                "str_base": hdata.get("str_base", 20),
                "str_gain": round(hdata.get("str_gain", 2.0), 2),
                "agi_base": hdata.get("agi_base", 20),
                "agi_gain": round(hdata.get("agi_gain", 2.0), 2),
                "int_base": hdata.get("int_base", 20),
                "int_gain": round(hdata.get("int_gain", 2.0), 2),
                "damage_min": hdata.get("damage_min", 50),
                "damage_max": hdata.get("damage_max", 56),
                "attack_rate": round(hdata.get("attack_rate", 1.7), 2),
                "attack_range": hdata.get("attack_range", 150),
                "projectile_speed": hdata.get("projectile_speed", 0),
                "armor": round(hdata.get("armor", 2.0), 1),
                "magic_resistance": hdata.get("magic_resistance", 25),
                "movement_speed": hdata.get("movement_speed") or od_h.get("move_speed") or 300,
                "turn_rate": round(hdata.get("turn_rate") or 0.6, 2),
                "sight_day": hdata.get("sight_range_day", 1800),
                "sight_night": hdata.get("sight_range_night", 800),
                "max_health": hdata.get("max_health", 600),
                "health_regen": round(hdata.get("health_regen", 2.5), 2),
                "max_mana": hdata.get("max_mana", 300),
                "mana_regen": round(hdata.get("mana_regen", 1.0), 2),
            },
            "abilities": abilities_out,
            "talents": talents_out,
            "trends": {
                "overall_winrate": overall_wr,
                "pub_picks": pub_pick,
                "pub_wins": pub_win,
                "turbo_winrate": turbo_wr,
                "turbo_picks": turbo_picks,
                "pro_pick": int(od_h.get("pro_pick") or 0),
                "pro_ban": int(od_h.get("pro_ban") or 0),
                "pro_win": int(od_h.get("pro_win") or 0),
                "brackets": bracket_stats,
                "daily_trend": daily_trend,
                "positions": positions_out,
                "primary_position": positions_out[0] if positions_out else None,
                "avg_stats": {
                    "kills": float(avg_info.get("avg_k") or 6.5),
                    "deaths": float(avg_info.get("avg_d") or 6.0),
                    "assists": float(avg_info.get("avg_a") or 11.5),
                    "gpm": int(avg_info.get("avg_gpm") or 460),
                    "xpm": int(avg_info.get("avg_xpm") or 610),
                    "hero_damage": int(avg_info.get("avg_hd") or 18000),
                    "tower_damage": int(avg_info.get("avg_td") or 2200),
                },
                "item_builds": {
                    "starting": start_ids,
                    "early": early_ids,
                    "core": core_out,
                    "luxury": luxury_out,
                    "neutral": neutral_out,
                },
                "skill_build": clean_sb,
            },
            "patch_notes": hero_patch_history.get(hid, []),
        }
        compiled_heroes.append(hero_obj)

    compiled_heroes.sort(key=lambda x: x["id"])
    print(f"   Compiled {len(compiled_heroes)} heroes with full 7.41f stats, skills, talents & meta trends.")

    # Also build structured Patch 7.41f + 7.41 general overview
    patch_overview = []
    for pv in patch_versions:
        pdata = patches_raw.get(pv)
        if not pdata:
            continue
        general_sections = []
        for sec in pdata.get("general_notes", []):
            title = sec.get("title", "通用改动")
            notes = [
                g.get("note")
                for g in sec.get("generic", [])
                if g.get("note") and g.get("note") != "<br>"
            ]
            if notes:
                general_sections.append({"title": title, "notes": notes})

        hero_changes_count = len(pdata.get("heroes", []))
        item_changes_count = len(pdata.get("items", [])) + len(pdata.get("neutral_items", []))
        patch_overview.append({
            "version": pv,
            "timestamp": pdata.get("patch_timestamp", 0),
            "general_sections": general_sections,
            "hero_changes_count": hero_changes_count,
            "item_changes_count": item_changes_count,
            "hero_ids": [h["hero_id"] for h in pdata.get("heroes", [])],
            "item_ids": [it["ability_id"] for it in pdata.get("items", []) + pdata.get("neutral_items", [])],
        })

    output_bundle = {
        "version": "7.41f",
        "updated_at": "2026-11-01",
        "heroes_count": len(compiled_heroes),
        "items_count": len(compiled_items),
        "heroes": compiled_heroes,
        "items": compiled_items,
        "patches": patch_overview,
    }

    os.makedirs("data", exist_ok=True)
    json_path = os.path.join("data", "wiki_data.json")
    js_path = os.path.join("data", "wiki_data.js")

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(output_bundle, f, ensure_ascii=False, separators=(",", ":"))

    with open(js_path, "w", encoding="utf-8") as f:
        f.write("window.DOTA2_WIKI_DATA = ")
        json.dump(output_bundle, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")

    print(f"Done! Wrote {json_path} ({os.path.getsize(json_path) / 1024 / 1024:.2f} MB) and {js_path}.")


if __name__ == "__main__":
    main()
