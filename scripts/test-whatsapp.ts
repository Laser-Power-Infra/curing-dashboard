// Queue one test WhatsApp message: npx tsx --env-file=.env scripts/test-whatsapp.ts 919830600932 "Hello"
import { queueWhatsApp } from "@/services/alerts/send";

const [to, text = "Test message from the Curing Dashboard."] = process.argv.slice(2);
if (!/^\d{8,15}$/.test(to ?? "")) throw new Error("Give the number as digits with country code, e.g. 919830600932");
queueWhatsApp(to, text).then((id) => console.log(`Queued for ${to}, id ${id}`));
