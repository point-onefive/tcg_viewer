/**
 * Hand-curated catalogue of One Piece TCG cards that have received an
 * official errata (text change) from Bandai.
 *
 * Source of truth: https://en.onepiece-cardgame.com/rules/errata_card/
 *
 * "Errata" here means the card's printed effect/trigger/type text was
 * later corrected by Bandai for misprints, translation cleanup, or
 * balance reasons. The errata text is binding in every official
 * format and takes precedence over what's on the physical card.
 *
 * Maintenance: re-scrape the page above whenever Bandai publishes a
 * new errata bulletin and append the new codes here (kept manual on
 * purpose so a CI break never silently desyncs the gallery filter
 * from the official list - every change here is a code-reviewable
 * commit).
 *
 * Last reviewed: 2026-05-25 (105 cards across OP01-OP09 + ST01-ST04 + ST14).
 */

export const ONE_PIECE_ERRATA_CODES: ReadonlySet<string> = new Set<string>([
  // OP01 (booster, 2022-09 + 2023-02 wording cleanup)
  'OP01-002', 'OP01-003', 'OP01-005', 'OP01-006', 'OP01-007',
  'OP01-014', 'OP01-015', 'OP01-016', 'OP01-017', 'OP01-020',
  'OP01-026', 'OP01-027', 'OP01-028', 'OP01-029', 'OP01-030',
  'OP01-033', 'OP01-034', 'OP01-035', 'OP01-038', 'OP01-040',
  'OP01-041', 'OP01-042', 'OP01-044', 'OP01-047', 'OP01-048',
  'OP01-049', 'OP01-050', 'OP01-051', 'OP01-054', 'OP01-056',
  'OP01-057', 'OP01-058', 'OP01-059', 'OP01-061', 'OP01-063',
  'OP01-064', 'OP01-069', 'OP01-070', 'OP01-071', 'OP01-074',
  'OP01-079', 'OP01-084', 'OP01-085', 'OP01-086', 'OP01-087',
  'OP01-088', 'OP01-089', 'OP01-090', 'OP01-093', 'OP01-096',
  'OP01-097', 'OP01-098', 'OP01-101', 'OP01-106', 'OP01-108',
  'OP01-112', 'OP01-113', 'OP01-115', 'OP01-116', 'OP01-117',
  'OP01-118', 'OP01-119',
  // OP02 - OP09 (per-bulletin spot fixes)
  'OP02-002', 'OP02-071',
  'OP03-047', 'OP03-054',
  'OP05-032',
  'OP06-034',
  'OP07-097',
  'OP09-058',
  // Starter decks
  'ST01-001', 'ST01-005', 'ST01-007', 'ST01-014', 'ST01-015',
  'ST01-016', 'ST01-017',
  'ST02-005', 'ST02-007', 'ST02-008', 'ST02-009', 'ST02-013',
  'ST02-015', 'ST02-016', 'ST02-017',
  'ST03-001', 'ST03-003', 'ST03-004', 'ST03-007', 'ST03-009',
  'ST03-014', 'ST03-015', 'ST03-016', 'ST03-017',
  'ST04-001', 'ST04-002', 'ST04-003', 'ST04-004', 'ST04-008',
  'ST04-010', 'ST04-014', 'ST04-015', 'ST04-016', 'ST04-017',
  'ST14-014',
])

/**
 * Convenience predicate so call sites can stay one-liners.
 * Lower-cases nothing; the bundle uses canonical "OP01-016" style
 * codes and the Set lookup is case-sensitive on purpose.
 */
export function isErrataCode(code: string | null | undefined): boolean {
  return typeof code === 'string' && ONE_PIECE_ERRATA_CODES.has(code)
}
