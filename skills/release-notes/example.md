# Release 1.5.0

> ⚠️ **New migrations: run `php artisan migrate`**
> - `2026_10_04_104344_add_rampant_drone_fabricator_signature_type`
> - `2026_10_04_104346_add_signatures_pasted_at_to_map_solarsystems_table`
> - `2026_10_04_104406_replace_rally_solarsystem_id_with_rally_solarsystem_ids_on_maps`
> - `2026_10_10_122956_add_user_id_to_map_route_solarsystems_table`

## Features

- Maps can have two rally points, and rally systems are highlighted.
- Signature pastes work from EVE clients in any language.
- Shows when signatures were last pasted. *(upstream #91)*
- New "expired" wormhole lifetime status. *(upstream #93)*

## Fixes

- The shared watch list was using the wrong event name.
- Bulk-deleting signatures with system removal no longer removes the origin system. *(upstream #87)*
- Added the missing Rampant Drone Fabricator combat site. *(upstream #90)*

## Performance

- The map killmails query only covers systems on the map. *(upstream #94)*
- Raidable skyhooks are saved in one upsert instead of many queries. *(upstream #92)*

## Dependencies

Production dependencies:
- markdown-it: 14.0.1 -> 15.2.1
- nicolaskion/eve: 0.10 -> 0.11
- Pest: 4.0.11 -> 5.1.0

Development dependencies:
- Vite: 2.0.1 -> 2.2.2

## Details

- Please refer to [the commits](https://github.com/Proudly-Snoring/WormholeSystems/compare/1.4.0...1.5.0).
