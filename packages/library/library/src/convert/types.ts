/** Input handed to a converter: the stored original file and its identity. */
export interface ConvertInput {
  /** Absolute path of the stored original file. */
  path: string
  /** Original display name (carries the extension converters key off). */
  name: string
  /** Sniffed media type; `''` when unknown. */
  mediaType: string
}

/**
 * One document-to-Markdown converter on the Library conversion seam. The spec
 * deliberately fixes no single tool (markitdown / anydoc / OCR are candidates),
 * so converters register per deployment and the service tries them by
 * descending {@link LibraryConverter.priority} until one succeeds.
 */
export interface LibraryConverter {
  /** Unique converter id, recorded on the resource as `convertedBy`. */
  id: string
  /** Selection order: larger priorities are tried first. */
  priority: number
  /**
   * Whether this converter accepts the file, judged from name and media type only.
   * @param input - The stored original file identity.
   * @returns `true` to attempt {@link LibraryConverter.convert}.
   */
  accepts(input: ConvertInput): boolean
  /**
   * Convert one file to Markdown.
   * @param input - The stored original file.
   * @returns the Markdown text.
   * @throws any error to let the next converter try; the last failure lands on the resource record.
   */
  convert(input: ConvertInput): Promise<string>
}
