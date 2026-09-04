# Sieve: mail filtering with require, if/elsif, actions.
require ["fileinto", "envelope", "regex", "variables"];

if header :contains "Subject" "Device check" {
    fileinto "NFE/Checks";
}
elsif address :is "from" "nfe@example.com" {
    if size :over 5M {
        discard;
    } else {
        fileinto "NFE";
    }
}
elsif header :regex "Subject" "^\\[nfe-([0-9]+)\\]" {
    set "ticket" "${1}";
    fileinto "NFE/Tickets";
}
else {
    keep;
}
