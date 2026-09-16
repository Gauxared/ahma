"use client";

import type { ReactNode } from "react";

export function AutoSubmitSelect({ 
  children, 
  name, 
  defaultValue, 
  className 
}: { 
  readonly children: ReactNode;
  readonly name: string;
  readonly defaultValue: string;
  readonly className: string;
}) {
  return (
    <select
      className={className}
      defaultValue={defaultValue}
      id="топбар-объект"
      name={name}
      onChange={(e) => e.target.form?.requestSubmit()}
    >
      {children}
    </select>
  );
}
