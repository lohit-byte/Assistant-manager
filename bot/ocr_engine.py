def extract_task(text_block, default_task):
            if "collect" in text_block and "gold" in text_block: return "Collect Gold"
            if "collect" in text_block and "food" in text_block: return "Collect Food"
            if "hatch" in text_block: 
                # E.g., "Hatch 19" or "Hatch 22 fire"
                return "Hatch Monsters"
            if "breed" in text_block: 
                return "Breed Monsters"
            if "rank up" in text_block: 
                return "Rank Up Monsters"
            if "level up" in text_block and "relic" in text_block: 
                # E.g., "Level 3 S-relics lvl 10"
                color = "Gold" if "gold relic" in text_block else ("Silver" if "silver relic" in text_block else "S")
                return f"Level Up {color} Relics".replace("  ", " ")
            if "craft" in text_block:
                # Dynamic Rune Levels: Matches "L2", "L5", "Level 3", "L14", etc.
                lv = re.search(r'(?:lvl|l|level)\s*(\d+)', text_block)
                if lv:
                    return f"Craft Level {lv.group(1)} Runes"
                return "Craft Runes"
            if re.search(r'\bwin\b', text_block): 
                return "Win Battles"
            if "feed" in text_block: 
                return "Feed Food"
            return default_task
