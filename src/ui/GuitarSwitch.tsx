// Which guitar is plugged in, and whether a tone was made for it.

import { store, useStore } from './store';
import { activeGuitar, type GuitarProfile } from '../ai/guitar';
import { recipeGuitarId, type ToneRecipe } from '../tonelab/recipe';

/** Quick switch for the guitar being played. */
export function GuitarSwitch({ label = 'Guitar' }: { label?: string }) {
  const guitars = useStore((s) => s.settings.guitars);
  const activeId = useStore((s) => s.settings.activeGuitarId);
  if (guitars.length < 2) return null;
  return (
    <label className="field guitar-switch">
      <span>{label}</span>
      <select value={activeId} onChange={(e) => store.setActiveGuitar(e.target.value)}>
        {guitars.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The profile a recipe was made for, if it still exists. */
export function recipeGuitar(recipe: ToneRecipe, guitars: readonly GuitarProfile[]): GuitarProfile | undefined {
  return guitars.find((g) => g.id === recipeGuitarId(recipe));
}

export function recipeGuitarName(recipe: ToneRecipe, guitars: readonly GuitarProfile[]): string {
  return recipeGuitar(recipe, guitars)?.name ?? recipe.guitarName ?? 'another guitar';
}

/** Warning shown when a tone was made for a different guitar than the one plugged in. */
export function GuitarMismatch({ recipe }: { recipe: ToneRecipe }) {
  const settings = useStore((s) => s.settings);
  const playing = activeGuitar(settings);
  if (recipeGuitarId(recipe) === playing.id) return null;
  return (
    <p className="guitar-mismatch">
      Made for the {recipeGuitarName(recipe, settings.guitars)}. You're playing the {playing.name}: expect to adjust gain and treble.
    </p>
  );
}
