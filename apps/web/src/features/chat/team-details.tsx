import type { BotPresence } from "@domos/agent/bots";
import type { Team } from "@domos/agent/teams";
import { BotAvatar } from "@domos/ui/avatar";
import { Button } from "@domos/ui/controls";
import { PanelGroup, PanelHeader, PanelRow } from "@domos/ui/panel";
import { ScrollArea } from "@domos/ui/scroll-area";
import { Tabs } from "@domos/ui/tabs";
import { FileTextIcon } from "@phosphor-icons/react/dist/csr/FileText";
import { UsersIcon } from "@phosphor-icons/react/dist/csr/Users";
import { WrenchIcon } from "@phosphor-icons/react/dist/csr/Wrench";
import { useState } from "react";
import { TeamAvatar } from "./bot-reference.tsx";
import { TeamDialog } from "./team-dialog.tsx";
import type { useChat } from "./use-chat.ts";
import { WorkPanel } from "./work.tsx";

export function TeamDetails({
  team,
  members,
  chat,
  tab,
  onTabChange,
  onMember,
  onClose,
  workRun,
  active,
  bots,
  onSaved,
}: {
  team: Team;
  members: BotPresence[];
  chat: ReturnType<typeof useChat>;
  tab: "team" | "work";
  onTabChange: (tab: "team" | "work") => void;
  onMember: (bot: BotPresence) => void;
  onClose: () => void;
  workRun?: string;
  active: boolean;
  bots: BotPresence[];
  onSaved: (team: Team) => void;
}) {
  const [page, setPage] = useState<"root" | "members">("root");
  const [editing, setEditing] = useState(false);
  const owner = members.find((member) => member.id === team.owner);
  return (
    <aside
      id="bot-details"
      className="bot-details"
      aria-label={`${team.name}的详情`}
    >
      <PanelHeader
        title={page === "members" ? "成员" : team.name}
        onBack={page !== "root" ? () => setPage("root") : undefined}
        onClose={onClose}
      />
      {page === "root" && (
        <div className="detail-identity">
          <div className="team-identity">
            <TeamAvatar members={members} />
            <h2>{team.name}</h2>
          </div>
          <Tabs.Root
            className="bot-tabs"
            value={tab}
            onValueChange={(value) => onTabChange(value as "team" | "work")}
          >
            <Tabs.List className="workspace-tabs" aria-label="团队详情">
              <Tabs.Tab className="navigation-tab" value="team">
                团队
              </Tabs.Tab>
              <Tabs.Tab className="navigation-tab" value="work">
                Work
              </Tabs.Tab>
            </Tabs.List>
          </Tabs.Root>
        </div>
      )}
      {page === "root" && tab === "work" ? (
        active && (
          <WorkPanel {...chat} botId={team.owner} selectedRun={workRun} />
        )
      ) : (
        <ScrollArea
          className="detail-scroll"
          viewportClassName="detail-content"
        >
          {page === "root" ? (
            <PanelGroup title="团队设置">
              <PanelRow
                icon={<FileTextIcon />}
                title="团队名称"
                value={team.name}
                onClick={() => setEditing(true)}
              />
              <PanelRow
                icon={<UsersIcon />}
                title="默认负责人"
                value={owner?.name}
                onClick={() => setEditing(true)}
              />
              <PanelRow
                icon={<FileTextIcon />}
                title="团队用途"
                value={team.purpose || "未填写"}
                onClick={() => setEditing(true)}
              />
              <PanelRow
                icon={<UsersIcon />}
                title="成员"
                value={String(members.length)}
                onClick={() => setPage("members")}
              />
              <PanelRow
                icon={<WrenchIcon />}
                title="工作记录"
                onClick={() => onTabChange("work")}
              />
            </PanelGroup>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setEditing(true)}>
                编辑成员
              </Button>
              <PanelGroup title="成员">
                {members.map((member) => (
                  <PanelRow
                    key={member.id}
                    icon={<BotAvatar seed={member.avatar} size="small" />}
                    title={member.name}
                    value={member.id === team.owner ? "默认负责人" : undefined}
                    onClick={() => onMember(member)}
                  />
                ))}
              </PanelGroup>
            </>
          )}
        </ScrollArea>
      )}
      {editing && (
        <TeamDialog
          team={team}
          bots={bots}
          open
          onOpenChange={setEditing}
          onSaved={onSaved}
        />
      )}
    </aside>
  );
}
