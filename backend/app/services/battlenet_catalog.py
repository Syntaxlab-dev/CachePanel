"""Static catalog of Battle.Net products.

Battle.Net has no public "owned games" API, and its total catalog is small
and effectively fixed (unlike Steam's large personal libraries). This list
is sourced directly from the authoritative upstream tool's source code:
https://github.com/tpill90/battlenet-lancache-prefill/blob/master/BattleNetPrefill/TactProduct.cs

Keep in sync manually if BattleNetPrefill adds new products.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class BattleNetProduct:
    code: str
    display_name: str
    publisher: str  # Blizzard | Activision | Microsoft


BATTLENET_CATALOG: list[BattleNetProduct] = [
    # Blizzard
    BattleNetProduct("rtro", "Blizzard Arcade Collection", "Blizzard"),
    BattleNetProduct("drtl", "Diablo", "Blizzard"),
    BattleNetProduct("anbs", "Diablo: Immortal", "Blizzard"),
    BattleNetProduct("osi", "Diablo 2: Resurrected", "Blizzard"),
    BattleNetProduct("d3", "Diablo 3", "Blizzard"),
    BattleNetProduct("fenris", "Diablo 4", "Blizzard"),
    BattleNetProduct("hsb", "Hearthstone", "Blizzard"),
    BattleNetProduct("hero", "Heroes of the Storm", "Blizzard"),
    BattleNetProduct("s1", "Starcraft Remastered", "Blizzard"),
    BattleNetProduct("s2", "Starcraft 2", "Blizzard"),
    BattleNetProduct("pro", "Overwatch 2", "Blizzard"),
    BattleNetProduct("w1r", "Warcraft 1: Remastered", "Blizzard"),
    BattleNetProduct("w2bn", "WarCraft II: Battle.net Edition", "Blizzard"),
    BattleNetProduct("w2r", "WarCraft II: Remastered", "Blizzard"),
    BattleNetProduct("w3", "Warcraft 3: Reforged", "Blizzard"),
    BattleNetProduct("gryphon", "Warcraft Rumble", "Blizzard"),
    BattleNetProduct("wow", "World Of Warcraft", "Blizzard"),
    BattleNetProduct("wow_classic", "WoW Cataclysm Classic", "Blizzard"),
    BattleNetProduct("wow_classic_era", "WoW Classic", "Blizzard"),
    # Activision
    BattleNetProduct("viper", "Call of Duty: Black Ops 4", "Activision"),
    BattleNetProduct("btlr", "Call of Duty: Black Ops 6", "Activision"),
    BattleNetProduct("zeus", "Call of Duty: Black Ops Cold War", "Activision"),
    BattleNetProduct("odin", "Call of Duty: Modern Warfare 2019", "Activision"),
    BattleNetProduct("nina", "Call of Duty: Modern Warfare II", "Activision"),
    BattleNetProduct("pinta", "Call of Duty: Modern Warfare III", "Activision"),
    BattleNetProduct("auks", "Call of Duty", "Activision"),
    BattleNetProduct("lazr", "Call of Duty: MW2 Remastered", "Activision"),
    BattleNetProduct("fore", "Call of Duty: Vanguard", "Activision"),
    BattleNetProduct("wlby", "Crash Bandicoot 4: It's About Time", "Activision"),
    # Microsoft
    BattleNetProduct("aqua", "Avowed", "Microsoft"),
    BattleNetProduct("scor", "Sea of Thieves", "Microsoft"),
]

BATTLENET_BY_CODE: dict[str, BattleNetProduct] = {p.code: p for p in BATTLENET_CATALOG}
