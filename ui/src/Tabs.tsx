import React, { useState } from "react";
import * as styles from "./tabs.css.ts";

export type Tab = {
  id: string;
  label: React.ReactNode;
  content?: React.ReactNode;
};

export type TabsProps = {
  tabs?: Tab[];
  defaultTab?: string;
  className?: string;
};

export default function Tabs({ tabs = [], defaultTab, className }: TabsProps) {
  const [activeId, setActiveId] = useState<string | null>(
    defaultTab ?? tabs[0]?.id ?? null,
  );

  return (
    <div className={`${styles.root}${className ? " " + className : ""}`}>
      <div className={styles.tabList} role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.id === activeId}
            className={`${styles.tab}${
              tab.id === activeId ? " " + styles.active : ""
            }`}
            onClick={() => setActiveId(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          className={`${styles.tabContent}${
            tab.id === activeId ? "" : " " + styles.hidden
          }`}
        >
          {tab.content ?? null}
        </div>
      ))}
    </div>
  );
}
