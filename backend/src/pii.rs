use regex::Regex;

pub fn redact(text: &str) -> (String, bool) {
    let mut redacted = text.to_string();
    let mut changed = false;

    let patterns = vec![
        // email
        Regex::new(r"(?i)[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}").unwrap(),
        // phone (naive)
        Regex::new(r"(?i)\b\+?\d{1,3}?[-.\s]??\(?\d{2,3}\)?[-.\s]??\d{3,4}[-.\s]??\d{4}\b")
            .unwrap(),
        // credit card (naive 13-16 digits)
        Regex::new(r"\b(?:\d[ -]*?){13,16}\b").unwrap(),
        // SSN (US)
        Regex::new(r"\b\d{3}-\d{2}-\d{4}\b").unwrap(),
        // simple street address: number + street name + suffix
        Regex::new(
            r"(?i)\b\d{1,5}\s+[A-Z][\w\s]{1,30}\s+(street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|court|ct|way)\b",
        )
        .unwrap(),
        // basic first/last name (two capitalized words)
        Regex::new(r"\b[A-Z][a-z]{1,20}\s+[A-Z][a-z]{1,20}\b").unwrap(),
    ];

    for re in patterns {
        let new = re.replace_all(&redacted, "[REDACTED]");
        if new != redacted {
            changed = true;
            redacted = new.into_owned();
        }
    }

    (redacted, changed)
}
