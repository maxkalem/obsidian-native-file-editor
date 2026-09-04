; mIRC scripting: aliases, events, variables, identifiers.
alias notes {
  var %count = 0, %limit = 5242880
  if ($1 > %limit) { inc %count }
  echo -a Large notes: %count ( $+ $calc(%limit / 1048576) MB limit)
  return %count
}

on *:TEXT:!notes*:#: {
  msg $chan $nick $+ : $notes($2) large file(s)
}

on *:JOIN:#nfe: { notice $nick Welcome, $nick $+ . Type !notes <size>. }
