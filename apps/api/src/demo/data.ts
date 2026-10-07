import type { ApplicationSource, ApplicationStatus, EventSource, PrepPack, WorkMode } from '@jt/shared';

/**
 * The public demo's data: entirely fictional companies, people and jobs. Dates are relative to
 * the day it's seeded (the demo reseeds nightly), so "this week" and follow-ups stay current.
 */
export interface DemoEvent {
  to: ApplicationStatus;
  source: EventSource;
  /** Days after the application date. */
  day: number;
  note?: string;
  confidence?: number;
  disposition?: 'applied' | 'pending_review';
}

export interface DemoEmail {
  from: string;
  subject: string;
  excerpt: string;
  category: 'received' | 'viewed' | 'assessment' | 'interview' | 'rejected' | 'offer';
  day: number;
}

export interface DemoApplication {
  company: string;
  role: string;
  location: string;
  workMode: WorkMode;
  source: ApplicationSource;
  sourceDetail: string;
  /** Days before today it was applied (null = saved, not applied). */
  appliedDaysAgo: number | null;
  jobUrl: string;
  salaryListed?: string;
  experienceAsked?: string;
  notes?: string;
  jd: string;
  events: DemoEvent[];
  answers?: [string, string][];
  emails?: DemoEmail[];
  followUpInDays?: number;
  prep?: PrepPack;
}

export const DEMO_PROFILE = {
  fullName: 'Asha Rao',
  headline: 'Full-stack engineer · Node.js, TypeScript, React',
  totalExperienceYears: 4,
  noticePeriodDays: 30,
  currentLocation: 'Pune, Maharashtra',
  relocationWilling: true,
  relocationPreference: 'Bengaluru or Hyderabad preferred',
  resumeText:
    'Asha Rao: Full-stack engineer, 4 years.\nNorthwind Retail (2023–now): built the order-tracking service (Node.js, PostgreSQL) handling 2M events a day; led the move from REST polling to webhooks; React admin dashboards used by 300 support agents.\nContoso Labs (2021–2023): TypeScript APIs, Redis caching (p95 900 ms → 180 ms), CI with GitHub Actions.\nSkills: Node.js, TypeScript, React, PostgreSQL, Redis, AWS (Lambda, SQS), Docker.',
};

export const DEMO_LIBRARY: [string, string][] = [
  ['Why are you looking for a change?', 'I want to work on a product with a bigger engineering team and own features end to end.'],
  ['Years of experience with Node.js', '4 years'],
  ['Are you comfortable with a hybrid setup?', 'Yes, up to 3 days a week in office.'],
];

const pack = (summary: string, questions: [string, string, string[]][], strengths: [string, string][], gaps: [string, string][]): PrepPack => ({
  summary,
  likelyQuestions: questions.map(([question, why, answerHints]) => ({ question, why, answerHints })),
  strengths: strengths.map(([point, evidence]) => ({ point, evidence })),
  gaps: gaps.map(([gap, howToAddress]) => ({ gap, howToAddress })),
  talkingPoints: ['The webhook migration: fewer moving parts and a 70% drop in API load', 'Owning on-call for the order service for a year'],
  questionsToAsk: ['What does the first quarter look like for this role?', 'How do product and engineering decide what ships next?'],
});

export const DEMO_APPLICATIONS: DemoApplication[] = [
  {
    company: 'Lumen Payments',
    role: 'Senior Backend Engineer',
    location: 'Bengaluru',
    workMode: 'hybrid',
    source: 'greenhouse',
    sourceDetail: 'Greenhouse',
    appliedDaysAgo: 24,
    jobUrl: 'https://job-boards.greenhouse.io/lumenpay/jobs/9100001',
    salaryListed: '32–40 LPA',
    experienceAsked: '4–7 yrs',
    notes: 'Panel was friendly. They care a lot about idempotency in payment flows.',
    jd: 'Build the ledger and payouts services (Node.js, TypeScript, PostgreSQL). Design idempotent APIs, own on-call, mentor two engineers. Kafka experience is a plus.',
    events: [
      { to: 'applied', source: 'extension_auto', day: 0, confidence: 0.95, note: 'Application submitted (Greenhouse confirmation page)' },
      { to: 'assessment', source: 'email', day: 4, confidence: 0.82, note: 'Email from greenhouse-mail.io: assessment invitation' },
      { to: 'interview', source: 'email', day: 11, confidence: 0.8, note: 'Email from lumenpay.example: interview invitation' },
    ],
    answers: [['Notice period', '30 days, negotiable to 15']],
    emails: [
      { from: 'Lumen Payments Hiring <no-reply@us.greenhouse-mail.io>', subject: 'Your coding assessment for Senior Backend Engineer', excerpt: 'Please complete the 90-minute assessment on HackerRank within 5 days.', category: 'assessment', day: 4 },
      { from: 'Meera Iyer <meera@lumenpay.example>', subject: 'Interview: system design round', excerpt: 'Thanks for the great assessment. We would like to invite you to a system design round on Thursday at 3 pm IST. The panel will focus on payment retries and idempotency.', category: 'interview', day: 11 },
    ],
    prep: pack(
      'A senior role on the payments ledger: correctness first (idempotent APIs, retries, reconciliation), then scale. You would own services end to end, including on-call, and mentor two engineers.',
      [
        ['How do you make a payment API idempotent?', 'The JD and the recruiter both stress idempotency.', ['Idempotency keys stored with the result', 'Your webhook retries at Northwind Retail']],
        ['Design a payouts service that never pays twice.', 'Core of the system design round.', ['State machine + outbox pattern', 'Reconciliation job']],
        ['Tell me about an incident you owned.', 'They expect on-call ownership.', ['The order-service queue backlog and the fix you shipped']],
      ],
      [['Node.js + PostgreSQL at scale', 'Order-tracking service handling 2M events a day'], ['Mentoring and ownership', 'Led the REST-to-webhooks migration']],
      [['No Kafka in production', 'You used SQS; explain the overlap and how you would learn Kafka’s ordering guarantees.']],
    ),
  },
  {
    company: 'Northwind Analytics',
    role: 'Full Stack Engineer',
    location: 'Remote',
    workMode: 'remote',
    source: 'linkedin',
    sourceDetail: 'LinkedIn Easy Apply',
    appliedDaysAgo: 18,
    jobUrl: 'https://www.linkedin.com/jobs/view/4100000201/',
    experienceAsked: '3–5 yrs',
    jd: 'React and Node.js dashboards for retail analytics. Some overlap with US Eastern hours. AWS, PostgreSQL.',
    events: [
      { to: 'applied', source: 'extension', day: 0, note: 'Saved from LinkedIn' },
      { to: 'viewed', source: 'email', day: 3, confidence: 0.92, note: 'Email from linkedin.com: application viewed' },
    ],
    answers: [['Are you comfortable working US hours?', 'Yes, I can overlap 4 hours with US Eastern time.']],
    emails: [{ from: 'LinkedIn <jobs-noreply@linkedin.com>', subject: 'Your application was viewed by Northwind Analytics', excerpt: 'Your application for Full Stack Engineer was viewed.', category: 'viewed', day: 3 }],
    followUpInDays: -1,
  },
  {
    company: 'Contoso Cloud',
    role: 'Platform Engineer',
    location: 'Hyderabad',
    workMode: 'onsite',
    source: 'lever',
    sourceDetail: 'Lever',
    appliedDaysAgo: 30,
    jobUrl: 'https://jobs.lever.co/contosocloud/1a2b3c4d-0000-4000-8000-000000000301',
    jd: 'Kubernetes, Terraform and CI/CD for 40 product teams. Go or Node.js.',
    events: [
      { to: 'applied', source: 'import', day: 0, note: 'Imported from tracker.xlsx, row #3' },
      { to: 'rejected', source: 'email', day: 9, confidence: 0.92, note: 'Email from contosocloud.example: rejection' },
    ],
    emails: [{ from: 'Contoso Cloud Talent <talent@contosocloud.example>', subject: 'Update on your application', excerpt: 'Unfortunately, we have decided to move forward with other candidates whose Kubernetes experience more closely matches the role.', category: 'rejected', day: 9 }],
  },
  {
    company: 'Fabrikam Health',
    role: 'Backend Developer',
    location: 'Pune',
    workMode: 'hybrid',
    source: 'naukri',
    sourceDetail: 'Naukri',
    appliedDaysAgo: 40,
    jobUrl: 'https://www.naukri.com/job-listings-backend-developer-fabrikam-health-pune-0410001',
    jd: 'Node.js services for patient scheduling. HIPAA-style data handling, PostgreSQL.',
    events: [
      { to: 'applied', source: 'manual', day: 0 },
      { to: 'interview', source: 'manual', day: 8, note: 'Phone screen with HR' },
      { to: 'offer', source: 'email', day: 21, confidence: 0.7, note: 'Email from fabrikamhealth.example: offer', disposition: 'pending_review' },
    ],
    notes: 'Offer letter mentions a 15-day joining window.',
    emails: [{ from: 'Fabrikam Health HR <hr@fabrikamhealth.example>', subject: 'Offer letter: Backend Developer', excerpt: 'We are delighted to extend you an offer of employment. Please review the attached offer letter and confirm within a week.', category: 'offer', day: 21 }],
  },
  {
    company: 'Tailspin Travel',
    role: 'Software Engineer II',
    location: 'Bengaluru',
    workMode: 'onsite',
    source: 'linkedin',
    sourceDetail: 'LinkedIn Easy Apply',
    appliedDaysAgo: 35,
    jobUrl: 'https://www.linkedin.com/jobs/view/4100000205/',
    jd: 'Booking engine in TypeScript; high-traffic search APIs; Redis.',
    events: [
      { to: 'applied', source: 'share', day: 0, note: 'Shared from the LinkedIn app' },
      { to: 'viewed', source: 'portal', day: 6, confidence: 0.9, note: 'LinkedIn: “Application viewed”' },
    ],
  },
  {
    company: 'Wingtip Labs',
    role: 'Node.js Developer',
    location: 'Remote',
    workMode: 'remote',
    source: 'company_portal',
    sourceDetail: 'Company careers page',
    appliedDaysAgo: 6,
    jobUrl: 'https://careers.wingtiplabs.example/jobs/node-developer',
    salaryListed: '18–24 LPA',
    jd: 'Event-driven Node.js services on AWS Lambda and SQS. Small team, lots of ownership.',
    events: [{ to: 'applied', source: 'extension', day: 0, note: 'Saved from the careers page' }],
  },
  {
    company: 'Adventure Works',
    role: 'Senior Full Stack Engineer',
    location: 'Hyderabad',
    workMode: 'hybrid',
    source: 'greenhouse',
    sourceDetail: 'Greenhouse',
    appliedDaysAgo: 3,
    jobUrl: 'https://job-boards.greenhouse.io/adventureworks/jobs/9100007',
    jd: 'Next.js and NestJS for an outdoor-gear marketplace; PostgreSQL; design system work.',
    events: [{ to: 'applied', source: 'extension_auto', day: 0, confidence: 0.95, note: 'Application submitted (Greenhouse confirmation page)' }],
    emails: [{ from: 'Adventure Works <no-reply@us.greenhouse-mail.io>', subject: 'Thank you for applying to Adventure Works', excerpt: 'We have received your application for Senior Full Stack Engineer.', category: 'received', day: 0 }],
  },
  {
    company: 'Proseware',
    role: 'API Engineer',
    location: 'Chennai',
    workMode: 'onsite',
    source: 'linkedin',
    sourceDetail: 'LinkedIn Easy Apply',
    appliedDaysAgo: 45,
    jobUrl: 'https://www.linkedin.com/jobs/view/4100000208/',
    jd: 'Public REST and GraphQL APIs for document workflows.',
    events: [{ to: 'applied', source: 'import', day: 0, note: 'Imported from tracker.xlsx, row #8' }],
  },
  {
    company: 'Litware',
    role: 'Backend Engineer',
    location: 'Bengaluru',
    workMode: 'hybrid',
    source: 'lever',
    sourceDetail: 'Lever',
    appliedDaysAgo: 14,
    jobUrl: 'https://jobs.lever.co/litware/1a2b3c4d-0000-4000-8000-000000000309',
    jd: 'Go and Node.js services for an invoicing platform; PostgreSQL; on-call.',
    events: [
      { to: 'applied', source: 'manual', day: 0 },
      { to: 'interview', source: 'email', day: 6, confidence: 0.6, note: 'Email from litware.example: interview invitation (matched by company only)', disposition: 'pending_review' },
    ],
    emails: [{ from: 'Karan at Litware <karan@litware.example>', subject: 'Interview availability', excerpt: 'Could you share your availability next week for a 45-minute technical interview?', category: 'interview', day: 6 }],
  },
  {
    company: 'Blue Yonder Airlines',
    role: 'Full Stack Developer',
    location: 'Gurugram',
    workMode: 'onsite',
    source: 'referral',
    sourceDetail: 'Referred by a former colleague',
    appliedDaysAgo: 28,
    jobUrl: 'https://careers.blueyonder.example/jobs/2041',
    jd: 'Crew-scheduling tools in React and Node.js.',
    events: [
      { to: 'applied', source: 'manual', day: 0 },
      { to: 'withdrawn', source: 'manual', day: 12, note: 'Withdrew: relocation to Gurugram didn’t work out' },
    ],
  },
  {
    company: 'Margie’s Travel',
    role: 'Software Engineer',
    location: 'Mumbai',
    workMode: 'hybrid',
    source: 'naukri',
    sourceDetail: 'Naukri',
    appliedDaysAgo: 50,
    jobUrl: 'https://www.naukri.com/job-listings-software-engineer-margies-travel-mumbai-0410011',
    jd: 'Travel booking APIs in Node.js; payments integration.',
    events: [
      { to: 'applied', source: 'import', day: 0, note: 'Imported from tracker.xlsx, row #11' },
      { to: 'ghosted', source: 'system', day: 30, note: 'No response for 30 days (you confirmed)' },
    ],
  },
  {
    company: 'Coho Vineyard Tech',
    role: 'Frontend-leaning Full Stack Engineer',
    location: 'Remote',
    workMode: 'remote',
    source: 'linkedin',
    sourceDetail: 'LinkedIn',
    appliedDaysAgo: null,
    jobUrl: 'https://www.linkedin.com/jobs/view/4100000212/',
    jd: 'React, TypeScript and design systems; some Node.js.',
    events: [],
  },
];
