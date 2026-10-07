import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyEmail } from '../src/email/classify';
import { extractJob } from '../src/email/extract';
import { domainOf, parseRawMessage } from '../src/email/sources';

const fixture = async (name: string) => (await parseRawMessage(readFileSync(path.join(import.meta.dirname, 'fixtures/emails', name))))!;

describe('confirmation emails: company, role, location and job link from each portal', () => {
  it.each([
    ['confirm-linkedin.eml', 'linkedin', { companyName: 'Kestrel Fintech', roleTitle: 'Senior Backend Engineer', location: 'Dubai, United Arab Emirates', jobUrl: 'https://www.linkedin.com/jobs/view/4199990001/' }],
    ['confirm-linkedin-current.eml', 'linkedin', { companyName: 'Corvane', roleTitle: 'Senior Backend Engineer', location: 'Bengaluru', jobUrl: 'https://www.linkedin.com/jobs/view/4199990009/' }],
    ['confirm-naukri.eml', 'naukri', { companyName: 'Orbit Labs Pvt Ltd', roleTitle: 'Node.js Developer', location: 'Pune', jobUrl: 'https://www.naukri.com/job-listings-node-js-developer-orbit-labs-pune-3-to-5-years-061026500123' }],
    ['confirm-greenhouse.eml', 'greenhouse', { companyName: 'Juniper Health', roleTitle: 'Platform Engineer', location: null, jobUrl: 'https://job-boards.greenhouse.io/juniperhealth/jobs/7001234' }],
    ['confirm-lever.eml', 'lever', { companyName: 'Nimbus Robotics', roleTitle: 'Robotics Software Engineer', location: null, jobUrl: 'https://jobs.lever.co/nimbusrobotics/2b1c3d4e-5f60-4718-9a2b-3c4d5e6f7a8b' }],
    ['confirm-workday.eml', 'workday', { companyName: 'Talon Aerospace', roleTitle: 'Software Engineer II', location: null, jobUrl: 'https://talonaero.wd5.myworkdayjobs.com/Careers/job/Bengaluru-India/Software-Engineer-II_R-24817' }],
    ['confirm-smartrecruiters.eml', 'smartrecruiters', { companyName: 'Quill Media', roleTitle: 'Data Analyst', location: null, jobUrl: 'https://jobs.smartrecruiters.com/QuillMedia/744000012345678' }],
    ['confirm-ashby.eml', 'ashby', { companyName: 'Ferrous Labs', roleTitle: 'Founding Engineer', location: null, jobUrl: 'https://jobs.ashbyhq.com/ferrouslabs/9f8e7d6c-5b4a-4321-8fed-cba987654321' }],
    ['confirm-successfactors.eml', 'successfactors', { companyName: 'Meridian Bank', roleTitle: 'Treasury Systems Developer', location: null, jobUrl: 'https://career5.successfactors.eu/career?company=meridianbank&career_job_req_id=48211' }],
  ])('%s', async (file, portal, expected) => {
    const raw = await fixture(file);
    const c = classifyEmail({ subject: raw.subject, text: raw.text, fromDomain: domainOf(raw.from.address) });
    expect(c).toMatchObject({ category: 'received', fromAts: true });
    const x = extractJob(raw);
    expect(x).toMatchObject({ portal, ...expected });
    expect(x.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it('the employer’s own confirmation is read too, but from an unknown sender', async () => {
    const x = extractJob(await fixture('employer-received.eml'));
    expect(x).toMatchObject({ companyName: 'Pylon', roleTitle: 'Site Reliability Engineer', portal: null });
  });

  it('incomplete wording gives no guess: confidence 0', () => {
    const x = extractJob({ messageId: 'x', from: { address: 'jobs-noreply@linkedin.com', name: 'LinkedIn' }, subject: 'Jobs you may be interested in', date: new Date(), text: 'New jobs for you: Backend Engineer at Many Companies.', links: [] });
    expect(x.confidence).toBe(0);
  });
});
