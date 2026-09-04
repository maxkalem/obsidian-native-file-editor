// Modelica: models, parameters, equations, connectors.
model NoteBuffer "A tank that fills with edits and drains on autosave"
  parameter Real limit = 5242880 "Bytes before preview-only";
  parameter Real rate = 1000 "Bytes per second typed";
  Real level(start = 0, fixed = true) "Unsaved bytes";
  Boolean large;
equation
  der(level) = if level < limit then rate else 0;
  large = level >= limit;
  when large then
    Modelica.Utilities.Streams.print("limit reached at t=" + String(time));
  end when;
  annotation (experiment(StopTime = 6000));
end NoteBuffer;
