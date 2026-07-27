import ConfirmDialog from '../../../components/ui/ConfirmDialog'
import Toast from '../../../components/ui/Toast'
import { parseCanvasRoute } from '../canvasRoutes'
import CanvasComposer from './CanvasComposer'
import CanvasListPage from './CanvasListPage'
import CanvasWorkspace from './CanvasWorkspace'

type Props = {
  path: string
}

export default function CanvasApp({ path }: Props) {
  const route = parseCanvasRoute(path)

  return (
    <>
      {route?.type === 'document'
        ? (
          <>
            <CanvasWorkspace key={route.docId} docId={route.docId} />
            <CanvasComposer />
          </>
        )
        : <CanvasListPage />}
      <ConfirmDialog />
      <Toast />
    </>
  )
}
