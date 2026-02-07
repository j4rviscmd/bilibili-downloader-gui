import {Composition, registerRoot} from 'remotion';
import {ReadmePromoGif} from './ReadmePromoGif';

export const RemotionVideo: React.FC = () => {
	return (
		<>
			<Composition
				id="ReadmePromoGif"
				component={ReadmePromoGif}
				durationInFrames={150} // 5秒 @ 30fps
				fps={30}
				width={600}
				height={50}
				defaultProps={{
					appName: 'Bilibili Downloader GUI',
					description: 'Bilibili動画を簡単にダウンロード',
				}}
			/>
		</>
	);
};

registerRoot(RemotionVideo);
