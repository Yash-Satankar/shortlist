import { Navigate, useSearchParams } from 'react-router';
import { parseShare } from '../lib/share';
import type { AddPageState } from './AddPage';

/**
 * Web Share Target (GET /share?title&text&url). Writes nothing: it only parses
 * what was shared and opens quick-add prefilled. Saving goes through the normal API.
 */
export function SharePage() {
  const [params] = useSearchParams();
  const prefill = parseShare({ title: params.get('title'), text: params.get('text'), url: params.get('url') });
  const state: AddPageState = { prefill, via: 'share' };
  return <Navigate to="/add" replace state={state} />;
}
