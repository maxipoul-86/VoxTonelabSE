import type { ToneRecipe } from '../tonelab/recipe';
import { SLOT_KEYS, EFFECT_SLOTS } from '../tonelab/spec';
import { useStore } from './store';
import { DEFAULT_GUITAR, SELECTOR_TEXT } from '../ai/guitar';
import { GuitarMismatch, recipeGuitar, recipeGuitarName } from './GuitarSwitch';

export function RecipeSummary({ recipe, fixes = [] }: { recipe: ToneRecipe; fixes?: string[] }) {
  const guitars = useStore((s) => s.settings.guitars);
  const made = recipeGuitar(recipe, guitars);
  const p = recipe.pedal;
  const g = recipe.guitar;
  const guitarText =
    g.kind === 'piezo'
      ? `Volume ${g.volume}, bass ${g.bass}, mid ${g.mid}, treble ${g.treble}`
      : `Switch ${SELECTOR_TEXT(made?.kind === 'split' ? made : DEFAULT_GUITAR)[g.selector]}, tone knob ${g.coils === 'humbucker' ? 'pushed (humbucker)' : 'pulled (single coil)'}, volume ${g.volume}, tone ${g.tone}`;
  const fx = SLOT_KEYS.filter((s) => p[s].on).map((s) => `${EFFECT_SLOTS[s].label}: ${p[s].type ?? '?'}`);
  return (
    <div className="summary">
      <div className="summary-head">
        <span className="lcd small">{p.name}</span>
        <div>
          <div className="title">{[recipe.request.song, recipe.request.artist].filter(Boolean).join(' — ')}</div>
          <div className="dim small">
            {[recipe.request.part, recipe.source === 'edited' ? 'your version' : recipe.source === 'ai' ? 'AI suggestion' : recipe.source, recipe.confidence && `confidence ${recipe.confidence}`]
              .filter(Boolean)
              .join(' · ')}
          </div>
        </div>
      </div>
      <dl className="facts">
        <dt>Channel A</dt>
        <dd>
          {p.channelA.amp} · {p.channelA.cabinet} · gain {p.channelA.gain}
        </dd>
        {p.channelB && (
          <>
            <dt>Channel B</dt>
            <dd>
              {p.channelB.amp} · {p.channelB.cabinet} · gain {p.channelB.gain}
            </dd>
          </>
        )}
        <dt>Effects</dt>
        <dd>{fx.length ? fx.join(' · ') : 'none'}</dd>
        <dt>Guitar</dt>
        <dd>
          <span className="dim">{recipeGuitarName(recipe, guitars)}: </span>
          {guitarText}
          <GuitarMismatch recipe={recipe} />
        </dd>
        {recipe.original && (recipe.original.guitar || recipe.original.amp) && (
          <>
            <dt>Original rig</dt>
            <dd>{[recipe.original.guitar, recipe.original.amp, recipe.original.effects, recipe.original.tuning].filter(Boolean).join(' · ')}</dd>
          </>
        )}
      </dl>
      {recipe.why && <p>{recipe.why}</p>}
      {recipe.tips && <p className="tip">{recipe.tips}</p>}
      {!!recipe.warnings?.length && (
        <ul className="warnings">
          {recipe.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      {!!fixes.length && <p className="dim small">Adjusted to fit the pedal: {fixes.join(' ')}</p>}
      {!!recipe.sources?.length && (
        <p className="small">
          Sources:{' '}
          {recipe.sources.map((s, i) => (
            <span key={s.url}>
              {i > 0 && ' · '}
              <a href={s.url} target="_blank" rel="noreferrer">
                {s.title}
              </a>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
