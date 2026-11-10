import { Anchor, Button, Group, Modal, ScrollArea, Table, Title, Typography } from "@mantine/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { type LegalDocument, legalText } from "@/legal/legal";

/** Terms of use or privacy policy, rendered from its Markdown file. */
export function LegalText({ doc }: { doc: LegalDocument }) {
  return (
    <Typography fz="sm">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _node, ...props }) => <Anchor {...props} target="_blank" rel="noreferrer" />,
          h1: ({ node: _node, ...props }) => <Title order={3} mb="xs" {...props} />,
          h2: ({ node: _node, ...props }) => <Title order={5} mt="md" mb={4} {...props} />,
          h3: ({ node: _node, ...props }) => <Title order={6} mt="sm" mb={4} {...props} />,
          table: ({ node: _node, ...props }) => (
            <Table.ScrollContainer minWidth={600}>
              <Table withTableBorder withColumnBorders fz="xs" {...props} />
            </Table.ScrollContainer>
          ),
        }}
      >
        {legalText(doc)}
      </Markdown>
    </Typography>
  );
}

/** The full text in its own window, e.g. from the settings. */
export function LegalTextModal({
  doc,
  onClose,
}: {
  doc: LegalDocument | null;
  onClose: () => void;
}) {
  return (
    <Modal
      opened={doc !== null}
      onClose={onClose}
      size="xl"
      zIndex={400}
      scrollAreaComponent={ScrollArea.Autosize}
    >
      {doc && <LegalText doc={doc} />}
    </Modal>
  );
}

/** Two buttons that open the terms of use and the privacy policy. */
export function LegalLinks() {
  const { t } = useTranslation();
  const [reading, setReading] = useState<LegalDocument | null>(null);
  return (
    <>
      <Group gap="xs" wrap="nowrap">
        <Button size="compact-sm" variant="light" onClick={() => setReading("privacy")}>
          {t("Login.Consent.Privacy")}
        </Button>
        <Button size="compact-sm" variant="light" onClick={() => setReading("terms")}>
          {t("Login.Consent.Terms")}
        </Button>
      </Group>
      <LegalTextModal doc={reading} onClose={() => setReading(null)} />
    </>
  );
}
