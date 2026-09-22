import { useState } from "react";
import PlaygroundPage from "@/components/PlaygroundPage";
import { ApiKeyContext, type KeyStatus, currentProvider } from "@/hooks/useApiKey";
import { DEFAULT_PROVIDER_ID } from "@/lib/providers";

export default function App() {
  const [apiKey, setApiKeyState] = useState("");
  const [keyStatus, setKeyStatus] = useState<KeyStatus>(null);
  const [providerId, setProviderIdState] = useState(DEFAULT_PROVIDER_ID);
  const [model, setModel] = useState(currentProvider(DEFAULT_PROVIDER_ID).models[0]?.id ?? "");
  const [customBaseURL, setCustomBaseURL] = useState("");

  const setApiKey = (key: string) => {
    setApiKeyState(key);
    setKeyStatus(null);
  };
  const setProviderId = (id: string) => {
    setProviderIdState(id);
    setKeyStatus(null);
  };

  return (
    <ApiKeyContext.Provider
      value={{
        apiKey,
        setApiKey,
        keyStatus,
        setKeyStatus,
        providerId,
        setProviderId,
        model,
        setModel,
        customBaseURL,
        setCustomBaseURL,
      }}
    >
      <PlaygroundPage />
    </ApiKeyContext.Provider>
  );
}
