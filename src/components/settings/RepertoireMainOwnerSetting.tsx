import { TextInput } from "@mantine/core";
import { useAtom } from "jotai";
import { useEffect, useState } from "react";
import { mainOwnerAtom } from "@/state/atoms";
import { DEFAULT_MAIN_OWNER } from "@/utils/repertoires";

// Saved when the field loses focus, so the repertoire groups don't regroup on every keystroke.
export default function RepertoireMainOwnerSetting() {
  const [stored, setStored] = useAtom(mainOwnerAtom);
  const [value, setValue] = useState(stored);

  useEffect(() => setValue(stored), [stored]);

  return (
    <TextInput
      w={200}
      placeholder={DEFAULT_MAIN_OWNER}
      value={value}
      onChange={(e) => setValue(e.currentTarget.value)}
      onBlur={() => setStored(value.trim())}
      onKeyDown={(e) => {
        if (e.key === "Enter") setStored(value.trim());
      }}
    />
  );
}
