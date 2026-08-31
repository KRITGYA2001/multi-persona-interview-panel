import nodemailer from 'nodemailer';
import type { FeedbackReport } from '@/types/conversation';

function getTransporter() {
  const user = process.env.EMAIL_HOST_USER;
  const pass = process.env.EMAIL_HOST_PASSWORD;
  if (!user || !pass) return null;
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });
}

function renderReportText(report: FeedbackReport): string {
  const lines: string[] = [];
  lines.push(`Interview report — ${report.roleTitle}`);
  if (report.candidateName) {
    lines.push(`Candidate: ${report.candidateName}`);
  }
  lines.push('');
  lines.push(report.overallSummary);
  lines.push('');
  lines.push(`Hiring likelihood: ${report.hiringScore}/100`);
  lines.push('');

  if (report.focusAreaCoverage.length > 0) {
    lines.push('Focus area coverage:');
    for (const item of report.focusAreaCoverage) {
      lines.push(`  - ${item.focusArea}: ${item.covered ? 'covered' : 'not covered'}`);
    }
    lines.push('');
  }

  for (const persona of report.personas) {
    lines.push(`${persona.label} panelist`);
    if (persona.strengths.length > 0) {
      lines.push('  Strengths:');
      for (const s of persona.strengths) lines.push(`    - ${s}`);
    }
    if (persona.concerns.length > 0) {
      lines.push('  Concerns:');
      for (const c of persona.concerns) lines.push(`    - ${c}`);
    }
    if (persona.notableQuotes.length > 0) {
      lines.push('  Notable quotes:');
      for (const q of persona.notableQuotes) lines.push(`    - "${q}"`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderReportHtml(report: FeedbackReport): string {
  const coverageRows = report.focusAreaCoverage
    .map(
      (item) =>
        `<li>${escapeHtml(item.focusArea)} — <strong>${item.covered ? 'covered' : 'not covered'}</strong></li>`,
    )
    .join('');

  const personaSections = report.personas
    .map((persona) => {
      const list = (label: string, items: string[]) =>
        items.length > 0
          ? `<p style="margin:8px 0 4px"><strong>${label}:</strong></p><ul>${items
              .map((i) => `<li>${escapeHtml(i)}</li>`)
              .join('')}</ul>`
          : '';
      return `
        <div style="margin-bottom:20px">
          <h3 style="margin-bottom:4px">${escapeHtml(persona.label)} panelist</h3>
          ${list('Strengths', persona.strengths)}
          ${list('Concerns', persona.concerns)}
          ${list('Notable quotes', persona.notableQuotes)}
        </div>`;
    })
    .join('');

  return `
    <div style="font-family:sans-serif;color:#222;line-height:1.5">
      <h2>Interview report — ${escapeHtml(report.roleTitle)}</h2>
      ${report.candidateName ? `<p style="margin:0 0 12px"><strong>Candidate:</strong> ${escapeHtml(report.candidateName)}</p>` : ''}
      <p style="margin:0 0 12px"><strong>Hiring likelihood:</strong> ${report.hiringScore}/100</p>
      <p>${escapeHtml(report.overallSummary)}</p>
      ${coverageRows ? `<h3>Focus area coverage</h3><ul>${coverageRows}</ul>` : ''}
      ${personaSections}
    </div>`;
}

// Best-effort recruiter notification: missing config or a send failure both
// resolve to false rather than throwing, so a candidate's report generation
// (and the response they're waiting on) is never affected by email delivery.
export async function sendRecruiterReportEmail(
  to: string,
  report: FeedbackReport,
): Promise<boolean> {
  const transporter = getTransporter();
  if (!transporter) return false;

  try {
    await transporter.sendMail({
      from: process.env.EMAIL_HOST_USER,
      to,
      subject: report.candidateName
        ? `Interview report — ${report.roleTitle} — ${report.candidateName}`
        : `Interview report — ${report.roleTitle}`,
      text: renderReportText(report),
      html: renderReportHtml(report),
    });
    return true;
  } catch (error) {
    console.error('[mailer] failed to send recruiter report:', error);
    return false;
  }
}
