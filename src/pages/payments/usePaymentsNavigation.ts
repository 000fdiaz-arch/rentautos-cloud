import { useRef, useState } from "react";
import type { PaymentTabId } from "./PaymentsTabs";

export default function usePaymentsNavigation() {
  const [isRegisterOpen, setIsRegisterOpen] = useState(true);
  const [isNotifiedOpen, setIsNotifiedOpen] = useState(false);
  const [isCashClosingOpen, setIsCashClosingOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isPendingOpen, setIsPendingOpen] = useState(false);
  const [isCardPendingOpen, setIsCardPendingOpen] = useState(false);
  const [isIncomeOpen, setIsIncomeOpen] = useState(false);
  const cashSectionRef = useRef<HTMLElement>(null);
  const registerSectionRef = useRef<HTMLElement>(null);
  const notifiedSectionRef = useRef<HTMLElement>(null);
  const pendingSectionRef = useRef<HTMLElement>(null);
  const pendingCardSectionRef = useRef<HTMLElement>(null);
  const historySectionRef = useRef<HTMLElement>(null);
  const incomeSectionRef = useRef<HTMLElement>(null);

  const activePaymentTab: PaymentTabId = isCashClosingOpen
    ? "cash"
    : isNotifiedOpen
      ? "notified"
      : isPendingOpen
        ? "pending"
        : isCardPendingOpen
          ? "cards"
          : isIncomeOpen
            ? "income"
          : isHistoryOpen
            ? "history"
            : "register";

  function selectPaymentTab(tab: PaymentTabId): void {
    setIsRegisterOpen(tab === "register");
    setIsNotifiedOpen(tab === "notified");
    setIsPendingOpen(tab === "pending");
    setIsCardPendingOpen(tab === "cards");
    setIsIncomeOpen(tab === "income");
    setIsHistoryOpen(tab === "history");
    setIsCashClosingOpen(tab === "cash");
    const targets = {
      register: registerSectionRef,
      notified: notifiedSectionRef,
      pending: pendingSectionRef,
      cards: pendingCardSectionRef,
      income: incomeSectionRef,
      history: historySectionRef,
      cash: cashSectionRef
    };
    requestAnimationFrame(() => requestAnimationFrame(() => {
      targets[tab].current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }));
  }

  return {
    isRegisterOpen,
    setIsRegisterOpen,
    isNotifiedOpen,
    setIsNotifiedOpen,
    isCashClosingOpen,
    setIsCashClosingOpen,
    isHistoryOpen,
    setIsHistoryOpen,
    isPendingOpen,
    setIsPendingOpen,
    isCardPendingOpen,
    setIsCardPendingOpen,
    isIncomeOpen,
    setIsIncomeOpen,
    cashSectionRef,
    registerSectionRef,
    notifiedSectionRef,
    pendingSectionRef,
    pendingCardSectionRef,
    historySectionRef,
    incomeSectionRef,
    activePaymentTab,
    selectPaymentTab
  };
}
