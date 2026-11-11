import type { BotPresence } from "@domos/agent/bots";
import type { Team } from "@domos/agent/teams";
import { BotAvatar } from "@domos/ui/avatar";
import { PanelGroup, PanelHeader, PanelRow } from "@domos/ui/panel";
import { ScrollArea } from "@domos/ui/scroll-area";
import { SettingRow } from "@domos/ui/setting-row";
import { Tabs } from "@domos/ui/tabs";
import { FileTextIcon } from "@phosphor-icons/react/dist/csr/FileText";
import { UsersIcon } from "@phosphor-icons/react/dist/csr/Users";
import { WrenchIcon } from "@phosphor-icons/react/dist/csr/Wrench";
import { useState } from "react";
import { TeamAvatar } from "./bot-reference.tsx";
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
}) {
  const [page, setPage] = useState<"root" | "members" | "purpose">("root");
  const owner = members.find((member) => member.id === team.owner);
  return (
    <aside
      id="bot-details"
      className="bot-details"
      aria-label={`${team.name}的详情`}
    >
      <PanelHeader
        title={
          page === "members"
            ? "成员"
            : page === "purpose"
              ? "团队用途"
              : team.name
        }
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
                icon={<UsersIcon />}
                title="默认负责人"
                value={owner?.name}
                onClick={() => owner && onMember(owner)}
              />
              <PanelRow
                icon={<FileTextIcon />}
                title="团队用途"
                value={team.purpose || "未填写"}
                onClick={() => setPage("purpose")}
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
          ) : page === "purpose" ? (
            <div className="panel-card">
              <SettingRow title="团队用途">
                <p className="team-purpose">{team.purpose || "未填写"}</p>
              </SettingRow>
            </div>
          ) : (
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
          )}
        </ScrollArea>
      )}
    </aside>
  );
}
