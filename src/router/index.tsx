import { createHashRouter } from 'react-router'
import AIChat from '@/pages/AIChat'
import AutoLuckyBag from '@/pages/AutoLuckyBag'
import AutoMessage from '@/pages/AutoMessage'
import AutoPopUp from '@/pages/AutoPopUp'
import AutoReply from '@/pages/AutoReply'
import AutoReplySettings from '@/pages/AutoReply/AutoReplySettings'
import LiveControl from '@/pages/LiveControl'
import RedPacket from '@/pages/RedPacket'
import Settings from '@/pages/SettingsPage'
import ViewerAccounts from '@/pages/ViewerAccounts'
import App from '../App'

export const router = createHashRouter([
  {
    path: '/',
    element: <App />,
    children: [
      {
        path: '/',
        element: <LiveControl />,
      },
      {
        path: '/auto-message',
        element: <AutoMessage />,
      },
      {
        path: '/auto-popup',
        element: <AutoPopUp />,
      },
      {
        path: '/viewer-accounts',
        element: <ViewerAccounts />,
      },
      {
        path: '/settings',
        element: <Settings />,
      },
      {
        path: '/ai-chat',
        element: <AIChat />,
      },
      {
        path: 'auto-reply',
        element: <AutoReply />,
      },
      {
        path: '/auto-reply/settings',
        element: <AutoReplySettings />,
      },
      {
        path: '/red-packet',
        element: <RedPacket />,
      },
      {
        path: '/auto-lucky-bag',
        element: <AutoLuckyBag />,
      },
    ],
  },
])
