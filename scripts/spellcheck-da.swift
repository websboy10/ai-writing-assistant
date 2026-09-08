// Danish spell check with no dependency to install: macOS already ships the
// dictionary that Mail and Pages use, and NSSpellChecker exposes it.
//
// Reads text on stdin, prints one misspelled word per line as `word<TAB>offset`.
// Exits 1 if anything was misspelled, so it can gate a verify script.
//
// The point of measuring this at all: the prompt asks for deliberate GRAMMAR
// slips in most sentences ("jeg prøver og skrive det") while forbidding
// misspellings absolutely. A spell checker is the one tool that can tell those
// two apart mechanically — it passes real words in the wrong place and catches
// words that do not exist.
//
// Usage: swift scripts/spellcheck-da.swift < text.txt
import Foundation
import AppKit

let text = String(data: FileHandle.standardInput.readDataToEndOfFile(), encoding: .utf8) ?? ""
let checker = NSSpellChecker.shared
checker.setLanguage("da")

var bad = 0
var start = 0
while start < text.utf16.count {
    let range = checker.checkSpelling(of: text, startingAt: start, language: "da",
                                      wrap: false, inSpellDocumentWithTag: 0, wordCount: nil)
    if range.location == NSNotFound || range.length == 0 { break }
    let ns = text as NSString
    let word = ns.substring(with: range)
    // Placeholders the product writes on purpose, and the bracketed names a
    // letter template carries. Not spelling.
    if !word.hasPrefix("[") {
        print("\(word)\t\(range.location)")
        bad += 1
    }
    start = range.location + max(range.length, 1)
}

exit(bad > 0 ? 1 : 0)
