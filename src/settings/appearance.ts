import type { FlixTranslateSettings } from './schema';

type PresetName = Exclude<FlixTranslateSettings['subtitleStylePreset'], 'custom'>;
type PresetValues = Pick<
  FlixTranslateSettings,
  | 'subtitleBackground'
  | 'subtitleOutline'
  | 'subtitleTextColor'
  | 'translatedFontWeight'
  | 'subtitleOpacity'
  | 'subtitleLineHeight'
>;

export const SUBTITLE_STYLE_PRESETS: Record<PresetName, PresetValues> = {
  netflix: {
    subtitleBackground: 'none',
    subtitleOutline: 'shadow',
    subtitleTextColor: '#ffffff',
    translatedFontWeight: 600,
    subtitleOpacity: 1,
    subtitleLineHeight: 1.2,
  },
  'soft-box': {
    subtitleBackground: 'soft',
    subtitleOutline: 'shadow',
    subtitleTextColor: '#ffffff',
    translatedFontWeight: 650,
    subtitleOpacity: 1,
    subtitleLineHeight: 1.22,
  },
  'solid-box': {
    subtitleBackground: 'solid',
    subtitleOutline: 'none',
    subtitleTextColor: '#ffffff',
    translatedFontWeight: 650,
    subtitleOpacity: 1,
    subtitleLineHeight: 1.22,
  },
  outline: {
    subtitleBackground: 'none',
    subtitleOutline: 'outline',
    subtitleTextColor: '#ffffff',
    translatedFontWeight: 650,
    subtitleOpacity: 1,
    subtitleLineHeight: 1.22,
  },
  minimal: {
    subtitleBackground: 'none',
    subtitleOutline: 'none',
    subtitleTextColor: '#ffffff',
    translatedFontWeight: 500,
    subtitleOpacity: 0.9,
    subtitleLineHeight: 1.18,
  },
};

export function appearanceForPreset(preset: PresetName): Partial<FlixTranslateSettings> {
  return { subtitleStylePreset: preset, ...SUBTITLE_STYLE_PRESETS[preset] };
}

export function subtitleAppearanceVariables(settings: FlixTranslateSettings): Record<string, string> {
  const backgrounds: Record<FlixTranslateSettings['subtitleBackground'], string> = {
    none: 'transparent',
    soft: 'rgba(0,0,0,.68)',
    solid: 'rgba(0,0,0,.94)',
  };
  const shadows: Record<FlixTranslateSettings['subtitleOutline'], string> = {
    none: 'none',
    shadow: '0 2px 3px #000,0 0 2px #000',
    outline: '-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000,0 2px 2px #000',
  };
  const boxed = settings.subtitleBackground !== 'none';
  return {
    '--ft-background': backgrounds[settings.subtitleBackground],
    '--ft-text-shadow': shadows[settings.subtitleOutline],
    '--ft-color': settings.subtitleTextColor,
    '--ft-weight': String(settings.translatedFontWeight),
    '--ft-opacity': String(settings.subtitleOpacity),
    '--ft-line-height': String(settings.subtitleLineHeight),
    '--ft-radius': boxed ? '.18em' : '0',
    '--ft-cue-padding': boxed ? '.1em .36em' : '.04em .08em',
  };
}
