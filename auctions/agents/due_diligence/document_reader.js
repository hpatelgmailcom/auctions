/**
 * document_reader.js
 *
 * The LLM half of the hybrid Due Diligence Agent. Sends the listing's
 * due-diligence documents (title reports, inspections, rent rolls, tax
 * records — PDFs and text files) plus the listing description to Claude
 * and extracts structured facts the deterministic financial model needs.
 *
 * Degrades gracefully: if @anthropic-ai/sdk is not installed or no
 * credentials are available, returns status !== 'ok' and the agent runs
 * deterministic-only with documented assumptions.
 */

import fs from 'fs';

const MODEL = 'claude-opus-4-8';

/** JSON schema for structured extraction. Unknown facts are OMITTED, not
 *  null — the structured-outputs API caps union-typed (nullable) parameters
 *  at 16, so optionality is expressed by leaving fields out of `required`.
 *  Downstream code reads every fact with `?? null`, so an omitted key and
 *  an explicit null behave identically. */
const FACTS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['property', 'income', 'taxes', 'title', 'inspection', 'environmental', 'insurance', 'qualitative_risks', 'source_notes'],
  properties: {
    property: {
      type: 'object', additionalProperties: false, required: [],
      properties: {
        square_footage: { type: 'number' },
        year_built:     { type: 'integer' },
        occupancy_pct:  { type: 'number' },
        tenancy:        { type: 'string' },
      },
    },
    income: {
      type: 'object', additionalProperties: false, required: [],
      properties: {
        gross_annual_income_usd: { type: 'number' },
        walt_years:              { type: 'number' },
        tenant_summary:          { type: 'string' },
      },
    },
    taxes: {
      type: 'object', additionalProperties: false, required: [],
      properties: {
        annual_tax_usd:          { type: 'number' },
        delinquent_usd:          { type: 'number' },
        special_assessments_usd: { type: 'number' },
      },
    },
    title: {
      type: 'object', additionalProperties: false, required: [],
      properties: {
        liens: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false, required: ['type'],
            properties: { type: { type: 'string' }, holder: { type: 'string' }, amount_usd: { type: 'number' } },
          },
        },
        exceptions:        { type: 'array', items: { type: 'string' } },
        deed_restrictions: { type: 'array', items: { type: 'string' } },
      },
    },
    inspection: {
      type: 'object', additionalProperties: false, required: [],
      properties: {
        deferred_maintenance_low_usd:  { type: 'number' },
        deferred_maintenance_high_usd: { type: 'number' },
        condition_notes:               { type: 'array', items: { type: 'string' } },
      },
    },
    environmental: {
      type: 'object', additionalProperties: false, required: [],
      properties: {
        flags:                { type: 'array', items: { type: 'string' } },
        remediation_low_usd:  { type: 'number' },
        remediation_high_usd: { type: 'number' },
      },
    },
    insurance: {
      type: 'object', additionalProperties: false, required: [],
      properties: { annual_premium_usd: { type: 'number' } },
    },
    qualitative_risks: { type: 'array', items: { type: 'string' } },
    source_notes:      { type: 'array', items: { type: 'string' } },
  },
};

const SYSTEM_PROMPT = `You are a commercial real estate due diligence analyst working for a reserve-auction bidder.
You are given the due diligence documents for a single auction listing (title reports, inspection reports, rent rolls, tax records, environmental studies) plus the broker's listing description.

Extract facts into the required JSON schema. Rules:
- Only report what a document or the description actually states. OMIT any field that is not stated — never estimate or infer numbers.
- Dollar amounts are annual unless the field name says otherwise. Deferred maintenance and remediation are one-time cost ranges.
- title.liens: include mortgages, tax liens, mechanic's liens, judgments, HOA liens — anything a buyer would have to pay off or that survives the sale.
- qualitative_risks: plain-English, one sentence each, written for an investor deciding whether to bid (e.g. lease expirations, single-tenant exposure, as-is clauses, contingency waivers, environmental red flags).
- source_notes: one entry per fact group you filled in, naming which document it came from.`;

/**
 * @param {{ files: Array<{name,path,kind}>, listing: object }} args
 * @returns {Promise<{status: string, facts: object|null, documents_reviewed: string[], error?: string}>}
 */
export async function extractFacts({ files, listing }) {
  const documents_reviewed = files.map(f => f.name);

  let Anthropic;
  try {
    ({ default: Anthropic } = await import('@anthropic-ai/sdk'));
  } catch {
    return { status: 'sdk_missing', facts: null, documents_reviewed,
             error: '@anthropic-ai/sdk is not installed — run `bun add @anthropic-ai/sdk` (or npm install) to enable document extraction' };
  }

  const content = [];
  for (const f of files) {
    if (f.kind === 'pdf') {
      content.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: fs.readFileSync(f.path).toString('base64') },
        title: f.name,
      });
    } else {
      content.push({ type: 'text', text: `--- Document: ${f.name} ---\n${fs.readFileSync(f.path, 'utf8')}` });
    }
  }

  const listingContext = [
    `Listing: ${listing.listing?.title ?? ''} — ${listing.listing?.address ?? ''}`,
    `Property types: ${(listing.property?.property_types ?? []).join(', ') || 'unknown'}`,
    listing.description ? `--- Broker description ---\n${listing.description}` : null,
    listing.investment_highlights ? `--- Investment highlights ---\n${listing.investment_highlights}` : null,
  ].filter(Boolean).join('\n\n');

  content.push({ type: 'text', text: `${listingContext}\n\nExtract the due diligence facts as JSON.` });

  let client;
  try {
    client = new Anthropic();
  } catch (err) {
    return { status: 'no_credentials', facts: null, documents_reviewed,
             error: 'No Anthropic credentials found — add ANTHROPIC_API_KEY to .env' };
  }

  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      system: SYSTEM_PROMPT,
      output_config: { format: { type: 'json_schema', schema: FACTS_SCHEMA } },
      messages: [{ role: 'user', content }],
    });
  } catch (err) {
    const status = err?.status === 401 ? 'no_credentials' : 'error';
    return { status, facts: null, documents_reviewed, error: err.message };
  }

  if (response.stop_reason === 'refusal') {
    return { status: 'error', facts: null, documents_reviewed, error: 'Model declined the request (stop_reason: refusal)' };
  }
  if (response.stop_reason === 'max_tokens') {
    return { status: 'error', facts: null, documents_reviewed, error: 'Extraction truncated (stop_reason: max_tokens)' };
  }

  const text = response.content.find(b => b.type === 'text')?.text;
  if (!text) return { status: 'error', facts: null, documents_reviewed, error: 'No text block in model response' };

  try {
    return { status: 'ok', facts: JSON.parse(text), documents_reviewed };
  } catch (err) {
    return { status: 'error', facts: null, documents_reviewed, error: `Failed to parse extraction JSON: ${err.message}` };
  }
}
