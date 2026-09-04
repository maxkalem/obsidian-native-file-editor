// TSX: a typed React component with JSX.
import React, { useState } from "react";

interface Props {
  readonly title: string;
  readonly count?: number;
}

export function Badge({ title, count = 0 }: Props): JSX.Element {
  const [open, setOpen] = useState<boolean>(false);
  return (
    <button className={open ? "nfe-badge open" : "nfe-badge"} onClick={() => setOpen(!open)}>
      {title} {count > 0 && <span>({count})</span>}
    </button>
  );
}
