export const state = {
  me: null,
  workspaceId: localStorage.getItem("royaltyos_workspace_id"),
  projectId: localStorage.getItem("royaltyos_project_id"),
  selectedContractId: null,
  version: "0.4.0",
};

export function clearSession(){state.me=null}
