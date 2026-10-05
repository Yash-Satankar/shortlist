import { FEATURE_LABELS, featureOffMessage, type Feature, type FeatureState } from '@jt/shared';
import { useFeatures, useSetFeatures } from '../../api/hooks';
import { ErrorNote, SectionLabel, Switch } from '../../components/ui';

/** Features that exist in this build, in Settings order. Each one is added here when it ships. */
const SHOWN: { feature: Feature; detail: string }[] = [{ feature: 'extension', detail: 'Save jobs and sync statuses from Chrome' }];

const stateLine = (feature: Feature, s: FeatureState, detail: string) => (s.enabled ? detail : featureOffMessage(feature, s));

/**
 * Settings → Features: switch optional features off (or back on) for yourself, within what
 * this server offers. Features the server doesn't offer aren't listed at all.
 */
export function FeaturesSection() {
  const features = useFeatures();
  const set = useSetFeatures();
  const rows = SHOWN.filter(({ feature }) => features.data && features.data.features[feature].reason !== 'instance_off');
  if (!rows.length) return null;

  return (
    <>
      <SectionLabel className="pt-[22px]" action="Switch off what you don’t use">
        Features
      </SectionLabel>
      <div className="flex flex-col gap-2.5 px-4">
        <div className="group">
          {rows.map(({ feature, detail }) => {
            const s = features.data!.features[feature];
            const on = features.data!.switches[feature] !== false;
            return (
              <div key={feature} className="gi pr-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm leading-5 font-semibold">{FEATURE_LABELS[feature]}</div>
                  <div className="ev-time truncate leading-4">{on ? stateLine(feature, s, detail) : 'Off'}</div>
                </div>
                <Switch checked={on} label={FEATURE_LABELS[feature]} onChange={(v) => set.mutate({ [feature]: v })} />
              </div>
            );
          })}
        </div>
        {set.error && <ErrorNote error={set.error} />}
      </div>
    </>
  );
}
